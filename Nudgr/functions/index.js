const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
admin.initializeApp();

/**
 * Cloud Function: delivers a Nudgr to the recipient via Firebase Cloud
 * Messaging when it transitions to "triggered".
 *
 * This runs on the server (with the Firebase Admin SDK) so that no FCM
 * server key or service-account secret is ever embedded in the mobile app.
 *
 * Deploy with: firebase deploy --only functions
 *
 * Falls back gracefully: if the recipient has no registered FCM tokens, the
 * app still receives the Nudgr through its Firestore listener.
 */
exports.sendNudgeOnTrigger = functions.firestore
  .document('nudges/{nudgeId}')
  .onUpdate((change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Only act on the moment a Nudgr becomes triggered.
    if (after.status !== 'triggered' || before.status === 'triggered') {
      return null;
    }

    const recipientUid = after.recipientUid;
    if (!recipientUid) return null;

    return admin
      .firestore()
      .collection('users')
      .doc(recipientUid)
      .get()
      .then((snap) => {
        const data = snap.data();
        const fcmTokens = (data && data.fcmTokens) || {};
        const tokens = Object.keys(fcmTokens).filter(Boolean);
        if (tokens.length === 0) {
          functions.logger.info('No FCM tokens for recipient ' + recipientUid);
          return null;
        }

        const payload = {
          notification: {
            title: 'Nudgr from ' + (after.senderName || 'someone'),
            body: after.message || 'You have a Nudgr!',
          },
          data: {
            nudgeId: context.params.nudgeId,
            type: 'nudge',
          },
          tokens,
        };

        return admin.messaging().sendEachForMulticast(payload);
      })
      .catch((err) => {
        functions.logger.error('sendNudgeOnTrigger failed', err);
        return null;
      });
  });
