const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
admin.initializeApp();

/**
 * Cloud Function: delivers a Nudgr to the recipient via Firebase Cloud
 * Messaging when a trigger event is created.
 *
 * This runs on the server (with the Firebase Admin SDK) so that no FCM
 * server key or service-account secret is ever embedded in the mobile app.
 *
 * Deploy with: firebase deploy --only functions
 */
exports.sendNudgeOnTrigger = functions.firestore
  .document('nudges/{nudgeId}/triggerEvents/{triggerEventId}')
  .onCreate(async (snap, context) => {
    const triggerData = snap.data();
    const nudgeId = context.params.nudgeId;
    
    if (!triggerData || triggerData.status !== 'CREATED') {
      return null;
    }

    // Get the full Nudgr document
    const nudgeSnap = await admin.firestore().collection('nudges').doc(nudgeId).get();
    if (!nudgeSnap.exists) {
      return null;
    }
    const nudge = nudgeSnap.data();

    

    const recipientUid = nudge.recipientUid;
    if (!recipientUid) return null;

    try {
      const userSnap = await admin
        .firestore()
        .collection('users')
        .doc(recipientUid)
        .get();

      const data = userSnap.data();
      const fcmTokens = (data && data.fcmTokens) || {};
      const tokens = Object.keys(fcmTokens).filter(Boolean);

      if (tokens.length === 0) {
        functions.logger.warn(`[RECIPIENT_TOKEN_MISSING] recipientUid=${recipientUid} nudgeId=${nudgeId}`);
        functions.logger.info('[NUDGR_DELIVERY] No FCM tokens for recipient ' + recipientUid + '; Firestore listener fallback is active');
        return null;
      }

      functions.logger.info(`[RECIPIENT_TOKEN_FOUND] recipientUid=${recipientUid} tokenCount=${tokens.length} nudgeId=${nudgeId}`);

      const senderName = nudge.senderName || 'Someone';
      
      // Data-only is intentional. An Android `notification` payload bypasses
      // the app and produces a generic system notification when backgrounded.
      // High-priority data wakes React Native Firebase's background handler,
      // which creates the dedicated local call-style notification with actions.
      const nudgeMessage = nudge.message || 'Incoming Nudgr';
      const payload = {
        data: {
          nudgeId: nudgeId,
          triggerEventId: context.params.triggerEventId,
          type: 'nudge_incoming',
          senderUid: nudge.senderUid || '',
          recipientUid: recipientUid,
          senderName: senderName,
          message: nudgeMessage,
        },
        tokens,
        android: {
          priority: 'high',
        },
        apns: {
          headers: { 'apns-priority': '5' },
          payload: {
            aps: {
              contentAvailable: true,
            },
          },
        },
      };

      functions.logger.info(`[FCM_SEND_STARTED] nudgeId=${nudgeId} recipientUid=${recipientUid} tokenCount=${tokens.length}`);
      const sendResult = await admin.messaging().sendEachForMulticast(payload);
      functions.logger.info(`[FCM_SEND_SUCCESS] nudgeId=${nudgeId} success=${sendResult.successCount}/${tokens.length} failures=${sendResult.failureCount}`);

      // Clean up invalid/expired tokens
      const tokensToRemove = [];
      sendResult.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code || '';
          functions.logger.warn(`[FCM_SEND_FAILURE] nudgeId=${nudgeId} tokenIndex=${idx} error=${errCode} message=${resp.error?.message || 'unknown'}`);
          if (errCode === 'messaging/invalid-registration-token' ||
              errCode === 'messaging/registration-token-not-registered') {
            tokensToRemove.push(tokens[idx]);
          }
        }
      });

      // Remove stale tokens from Firestore
      if (tokensToRemove.length > 0) {
        const updates = {};
        tokensToRemove.forEach(t => { updates[`fcmTokens.${t}`] = admin.firestore.FieldValue.delete(); });
        await admin.firestore().collection('users').doc(recipientUid).update(updates);
        functions.logger.info(`[FCM_TOKEN_CLEANUP] recipientUid=${recipientUid} removed=${tokensToRemove.length} stale tokens`);
      }

      // Update trigger event to mark FCM sent
      await snap.ref.update({ 
        status: 'FCM_SENT', 
        fcmSentAt: admin.firestore.FieldValue.serverTimestamp(),
        fcmSuccessCount: sendResult.successCount,
        fcmFailureCount: sendResult.failureCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp() 
      });
    } catch (err) {
      functions.logger.error(`[FCM_SEND_FAILURE] nudgeId=${nudgeId} error=${err.message}`, err);
      await snap.ref.update({ 
        status: 'FCM_FAILED', 
        error: err.message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp() 
      });
    }

    return null;
  });

/**
 * Cloud Function: marks the Nudgr as triggered when the first trigger event fires.
 * Updates the parent Nudgr document status.
 */
exports.updateNudgeOnTrigger = functions.firestore
  .document('nudges/{nudgeId}/triggerEvents/{triggerEventId}')
  .onCreate(async (snap, context) => {
    const nudgeId = context.params.nudgeId;
    const triggerData = snap.data();
    
    if (!triggerData) return null;

    const nudgeRef = admin.firestore().collection('nudges').doc(nudgeId);
    
    // Transactionally update the Nudgr status to triggered
    await admin.firestore().runTransaction(async (transaction) => {
      const nudgeDoc = await transaction.get(nudgeRef);
      if (!nudgeDoc.exists) return;

      const nudge = nudgeDoc.data();
      if (nudge.status === 'triggered' || nudge.status === 'completed') {
        // Already processed
        return;
      }

      transaction.update(nudgeRef, {
        status: 'triggered',
        triggeredAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return null;
  });

/**
 * Cloud Functions for Cloudflare R2 Presigned URLs
 */


exports.getVoiceUploadUrl = functions.https.onRequest((req, res) => {
  const { handleGetVoiceUploadUrl } = require('./r2');
  return handleGetVoiceUploadUrl(req, res);
});

exports.getVoiceDownloadUrl = functions.https.onRequest((req, res) => {
  const { handleGetVoiceDownloadUrl } = require('./r2');
  return handleGetVoiceDownloadUrl(req, res);
});
