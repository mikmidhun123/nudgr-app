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
  let active = true;

  const handle = (remoteMessage) => {
    if (!active || !remoteMessage) return null;
    const data = remoteMessage.data || {};
    // Only handle nudge_incoming or nudge type for incoming experience
    if (data.type === 'nudge_incoming' || data.type === 'nudge' || data.nudgeId) {
      return {
        nudgeId: data.nudgeId || null,
        senderName: data.senderName || null,
        message: data.message || null,
        data,
        sentTime: remoteMessage.sentTime,
      };
    }
    return null;
  };

  const unsubOn = messaging.onMessage((remoteMessage) => {
    console.log(`[FCM_FOREGROUND_RECEIVED] FCM onMessage messageId=${remoteMessage?.messageId}`);
    const info = handle(remoteMessage);
    if (info?.nudgeId && onNudgeMessage) {
      console.log(`[FCM_RECEIVED_FOREGROUND] nudgeId=${info.nudgeId} senderName=${info.senderName}`);
      onNudgeMessage(info.nudgeId, info);
    }
  });

  const unsubOpened = messaging.onNotificationOpenedApp((remoteMessage) => {
    console.log('[NOTIFICATION_DEBUG] FCM onNotificationOpenedApp (from background):', remoteMessage?.messageId);
    const info = handle(remoteMessage);
    if (info?.nudgeId && onNudgeOpened) {
      onNudgeOpened(info.nudgeId, info);
    }
  });

  messaging
    .getInitialNotification()
    .then((remoteMessage) => {
      if (remoteMessage) {
        console.log('[NOTIFICATION_DEBUG] FCM getInitialNotification (from killed state):', remoteMessage?.messageId);
        const info = handle(remoteMessage);
        if (info?.nudgeId && onNudgeOpened) {
          onNudgeOpened(info.nudgeId, info);
        }
      }
    })
    .catch((e) => {
      console.warn('[NOTIFICATION_DEBUG] getInitialNotification error:', e?.message || e);
    });

  return () => {
    active = false;
    unsubOn();
    unsubOpened();
  };
}

