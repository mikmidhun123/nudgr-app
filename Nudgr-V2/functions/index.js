const functions = require('firebase-functions/v1');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
initializeApp();

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

    // onCreate can be delivered more than once with the original CREATED
    // snapshot. Claim the live event atomically so concurrent invocations
    // cannot send the same trigger twice.
    const claimed = await getFirestore().runTransaction(async (transaction) => {
      const current = await transaction.get(snap.ref);
      if (!current.exists || current.data().status !== 'CREATED') return false;
      transaction.update(snap.ref, {
        status: 'FCM_SENDING',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!claimed) {
      functions.logger.info(`[FCM_SEND_SKIPPED] nudgeId=${nudgeId} triggerEventId=${context.params.triggerEventId} reason=ALREADY_CLAIMED`);
      return null;
    }
    try {
      const nudgeSnap = await getFirestore().collection('nudges').doc(nudgeId).get();
      if (!nudgeSnap.exists) {
        const error = new Error('Nudgr document is missing');
        error.code = 'NUDGR_MISSING';
        throw error;
      }
      const nudge = nudgeSnap.data();
      const recipientUid = nudge.recipientUid;
      if (!recipientUid) {
        const error = new Error('Nudgr recipient is missing');
        error.code = 'RECIPIENT_MISSING';
        throw error;
      }
      const userSnap = await getFirestore()
        .collection('users')
        .doc(recipientUid)
        .get();

      const data = userSnap.data();
      const fcmTokens = (data && data.fcmTokens) || {};
      const tokens = Object.keys(fcmTokens).filter(Boolean);

      if (tokens.length === 0) {
        functions.logger.warn(`[RECIPIENT_TOKEN_MISSING] recipientUid=${recipientUid} nudgeId=${nudgeId}`);
        functions.logger.info('[NUDGR_DELIVERY] No FCM tokens for recipient ' + recipientUid + '; Firestore listener fallback is active');
        await snap.ref.update({
          status: 'FCM_FAILED',
          error: 'RECIPIENT_TOKEN_MISSING',
          updatedAt: FieldValue.serverTimestamp(),
        });
        return null;
      }

      functions.logger.info(`[RECIPIENT_TOKEN_FOUND] recipientUid=${recipientUid} tokenCount=${tokens.length} nudgeId=${nudgeId}`);

      const senderName = nudge.senderName || 'Someone';
      
      // Native notification delivery is the fallback when headless JS cannot
      // run. The local call-style notification uses this same Android tag/id
      // to replace it with Answer/Decline, rather than posting a second alert.
      const nudgeMessage = nudge.message || 'Incoming Nudgr';
      const payload = {
        notification: {
          title: '📍 Nudgr',
          body: `${senderName} sent you a Nudgr`,
        },
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
          notification: {
            channelId: 'nudgr_calls_v3',
            sound: 'ringtone',
            defaultSound: false,
            defaultVibrateTimings: false,
            // Admin SDK serializes these to PRIORITY_MAX / PUBLIC.
            priority: 'max',
            visibility: 'public',
            vibrateTimingsMillis: [0, 800, 200, 800],
            tag: `nudgr_${nudgeId}`,
          },
        },
        apns: {
          headers: { 'apns-priority': '10' },
          payload: {
            aps: {
              contentAvailable: true,
              sound: 'ringtone.mp3',
              category: 'nudgr_incoming',
            },
          },
        },
      };

      functions.logger.info(`[BACKEND_SEND_STARTED] nudgeId=${nudgeId} triggerEventId=${context.params.triggerEventId} recipientUid=${recipientUid} tokenCount=${tokens.length}`);
      const sendResult = await getMessaging().sendEachForMulticast(payload);
      const accepted = sendResult.successCount > 0;
      functions.logger.info(`[${accepted ? 'FCM_SEND_SUCCESS' : 'FCM_SEND_FAILED'}] nudgeId=${nudgeId} success=${sendResult.successCount}/${tokens.length} failures=${sendResult.failureCount}`);

      // FCM acceptance is not proof of display on the device. Persist the
      // result before best-effort token cleanup, which must not undo success.
      await snap.ref.update({
        status: accepted ? 'FCM_SENT' : 'FCM_FAILED',
        ...(accepted
          ? { fcmSentAt: FieldValue.serverTimestamp() }
          : { error: 'FCM_ALL_TOKENS_FAILED' }),
        fcmSuccessCount: sendResult.successCount,
        fcmFailureCount: sendResult.failureCount,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Clean up invalid/expired tokens
      const tokensToRemove = [];
      sendResult.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code || '';
          functions.logger.warn(`[FCM_SEND_FAILED] nudgeId=${nudgeId} tokenIndex=${idx} error=${errCode}`);
          if (errCode === 'messaging/invalid-registration-token' ||
              errCode === 'messaging/registration-token-not-registered') {
            tokensToRemove.push(tokens[idx]);
          }
        }
      });

      // Remove stale tokens from Firestore
      if (tokensToRemove.length > 0) {
        const updates = {};
        tokensToRemove.forEach(t => { updates[`fcmTokens.${t}`] = FieldValue.delete(); });
        try {
          await getFirestore().collection('users').doc(recipientUid).update(updates);
          functions.logger.info(`[FCM_TOKEN_CLEANUP] recipientUid=${recipientUid} removed=${tokensToRemove.length} stale tokens`);
        } catch (cleanupError) {
          functions.logger.warn(`[FCM_TOKEN_CLEANUP_FAILED] nudgeId=${nudgeId} error=${cleanupError.code || 'unknown'}`);
        }
      }
    } catch (err) {
      functions.logger.error(`[FCM_SEND_FAILED] nudgeId=${nudgeId} error=${err.code || 'unknown'}`);
      await snap.ref.update({ 
        status: 'FCM_FAILED', 
        error: err.code || 'FCM_SEND_FAILED',
        updatedAt: FieldValue.serverTimestamp()
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

    const nudgeRef = getFirestore().collection('nudges').doc(nudgeId);
    
    // Transactionally update the Nudgr status to triggered
    await getFirestore().runTransaction(async (transaction) => {
      const nudgeDoc = await transaction.get(nudgeRef);
      if (!nudgeDoc.exists) return;

      const nudge = nudgeDoc.data();
      if (nudge.status === 'triggered' || nudge.status === 'completed') {
        // Already processed
        return;
      }

      transaction.update(nudgeRef, {
        status: 'triggered',
        triggeredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
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
