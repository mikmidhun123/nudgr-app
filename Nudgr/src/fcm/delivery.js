import { getMessaging } from '../firebase';

/**
 * Wires up Firebase Cloud Messaging listeners.
 *
 * Outbound FCM delivery to the recipient is performed by a Cloud Function
 * (see functions/index.js) so that no server key / service-account secret is
 * ever embedded in the mobile app. When the function sends a push, this client
 * receives it and surfaces the Nudgr.
 *
 * - onMessage: app is foreground → caller shows the incoming experience.
 * - onNotificationOpenedApp: app was backgrounded and user tapped the push.
 * - getInitialNotification: app was killed and user tapped the push.
 */
export function attachFcmListeners({ onNudgeMessage, onNudgeOpened }) {
  const messaging = getMessaging();

  const handle = (remoteMessage) => {
    if (!remoteMessage) return null;
    const nudgeId = remoteMessage.data?.nudgeId;
    return nudgeId || null;
  };

  const unsubOn = messaging.onMessage((remoteMessage) => {
    const nudgeId = handle(remoteMessage);
    if (nudgeId && onNudgeMessage) onNudgeMessage(nudgeId);
  });

  const unsubOpened = messaging.onNotificationOpenedApp((remoteMessage) => {
    const nudgeId = handle(remoteMessage);
    if (nudgeId && onNudgeOpened) onNudgeOpened(nudgeId);
  });

  messaging
    .getInitialNotification()
    .then((remoteMessage) => {
      const nudgeId = handle(remoteMessage);
      if (nudgeId && onNudgeOpened) onNudgeOpened(nudgeId);
    })
    .catch(() => {});

  return () => {
    unsubOn();
    unsubOpened();
  };
}
