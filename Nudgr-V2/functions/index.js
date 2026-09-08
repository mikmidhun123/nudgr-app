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

    // Check if already processed (idempotency)
    if (triggerData.status === 'FCM_SENT' || triggerData.status === 'COMPLETED') {
      return null;
    }

    const recipientUid = nudge.recipientUid;
    if (!recipientUid) return null;

    // Update trigger event status to FCM_SENT (optimistic)
    await snap.ref.update({ status: 'FCM_SENT', updatedAt: admin.firestore.FieldValue.serverTimestamp() });

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
        functions.logger.info('No FCM tokens for recipient ' + recipientUid);
        // Still mark as sent - recipient will get it via Firestore listener
        return null;
      }

      const senderName = nudge.senderName || 'Someone';
      
      // Send FCM with high priority and call-style notification
      // We send data-only FCM and let the app handle showing the notification
      // with the correct channel/category for call-style experience
      const payload = {
        data: {
          nudgeId: nudgeId,
          triggerEventId: context.params.triggerEventId,
          type: 'nudge_incoming',
          senderName: senderName, // For notification content when app is background/killed
        },
        tokens,
        android: {
          priority: 'high',
          notification: {
            title: 'Incoming Nudgr',
            body: `From ${senderName}`,
            channelId: 'nudgr_calls',
            sound: 'ringtone.mp3',
            color: '#2e7d32',
            tag: nudgeId, // For deduplication
          },
        },
        apns: {
          payload: {
            aps: {
              contentAvailable: true,
              priority: 10,
              alert: {
                title: 'Incoming Nudgr',
                body: `From ${senderName}`,
              },
              sound: 'ringtone.mp3',
              category: 'nudgr_incoming',
              threadId: nudgeId,
            },
          },
        },
      };

      await admin.messaging().sendEachForMulticast(payload);
      functions.logger.info('FCM sent for nudge ' + nudgeId + ' to ' + tokens.length + ' tokens');
      
      // Update trigger event to mark FCM sent
      await snap.ref.update({ 
        status: 'FCM_SENT', 
        fcmSentAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp() 
      });
    } catch (err) {
      functions.logger.error('sendNudgeOnTrigger failed', err);
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
const { handleGetVoiceUploadUrl, handleGetVoiceDownloadUrl } = require('./r2');

exports.getVoiceUploadUrl = functions.https.onRequest((req, res) => {
  return handleGetVoiceUploadUrl(req, res);
});

exports.getVoiceDownloadUrl = functions.https.onRequest((req, res) => {
  return handleGetVoiceDownloadUrl(req, res);
});

