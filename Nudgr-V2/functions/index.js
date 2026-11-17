const functions = require('firebase-functions/v1');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
initializeApp();

const { createDelivery } = require('./delivery');
const delivery = createDelivery({ getFirestore, getMessaging, FieldValue, logger: functions.logger });

exports.sendNudgeOnTrigger = functions.firestore
  .document('nudges/{nudgeId}/triggerEvents/{triggerEventId}')
  .onCreate(delivery.deliver);

exports.retryPendingNudges = functions.pubsub.schedule('every 1 minutes').onRun(delivery.retryDue);
exports.expireStaleDevices = functions.pubsub.schedule('every 24 hours').onRun(delivery.expireStaleDevices);

/**
 * Cloud Function: marks a one-shot Nudgr as triggered when the first trigger event fires.
 * Repeating Nudgrs ('once_per_day', 'multiple_per_day') remain status='active'.
 */
exports.updateNudgeOnTrigger = functions.firestore
  .document('nudges/{nudgeId}/triggerEvents/{triggerEventId}')
  .onCreate(async (snap, context) => {
    const nudgeId = context.params.nudgeId;
    const triggerData = snap.data();

    if (!triggerData) return null;

    const nudgeRef = getFirestore().collection('nudges').doc(nudgeId);

    await getFirestore().runTransaction(async (transaction) => {
      const nudgeDoc = await transaction.get(nudgeRef);
      if (!nudgeDoc.exists) return;

      const nudge = nudgeDoc.data();
      if (
        !['active', 'scheduled'].includes(nudge.status) ||
        nudge.enabled === false ||
        triggerData.senderUid !== nudge.senderUid ||
        triggerData.recipientUid !== nudge.recipientUid
      ) {
        return;
      }

      const repeatMode = nudge.repeatMode || 'once';
      transaction.update(nudgeRef, {
        status: repeatMode === 'once' ? 'triggered' : 'active',
        triggeredAt: nudge.triggeredAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return null;
  });

/**
 * Cloud Functions for Cloudflare R2 Presigned URLs & Nudgr Management
 */

exports.getVoiceUploadUrl = functions.https.onRequest((req, res) => {
  const { handleGetVoiceUploadUrl } = require('./r2');
  return handleGetVoiceUploadUrl(req, res);
});

exports.getVoiceDownloadUrl = functions.https.onRequest((req, res) => {
  const { handleGetVoiceDownloadUrl } = require('./r2');
  return handleGetVoiceDownloadUrl(req, res);
});

exports.connectByCode = functions.https.onRequest((req, res) => require('./connections').handleConnectByCode(req, res));

exports.deleteNudge = functions.https.onRequest((req, res) => require('./nudges').handleDeleteNudge(req, res));

// Older clients keep private account records during rollout. Publish display fields only.
exports.syncPublicProfile = functions.firestore.document('users/{uid}').onWrite(async (change, context) => {
  if (!change.after.exists) return getFirestore().collection('profiles').doc(context.params.uid).delete();
  return getFirestore().collection('profiles').doc(context.params.uid)
    .set(require('./connections').profile(context.params.uid, change.after.data()));
});
