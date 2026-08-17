import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const NUDGR_CHANNEL_ID = 'nudgr_alerts';

// Ensure notifications show alerts, sound, and badge even when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Initializes the dedicated Android Notification Channel for high-priority alerts.
 */
export async function setupNotificationChannels() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(NUDGR_CHANNEL_ID, {
      name: 'Nudgr Alerts',
      description: 'Incoming location arrival nudges from your connections',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500],
      lightColor: '#2e7d32',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
    });
  }
}

/**
 * Displays a local Heads-Up Notification when a Nudgr is triggered.
 *
 * @param {object} nudge The Nudge document data.
 */
export async function showLocalNudgeNotification(nudge) {
  if (!nudge || !nudge.id) return;

  const senderName = nudge.senderName || 'Someone';
  const title = `Nudgr from ${senderName}`;
  const body = nudge.message || 'You arrived at your Nudgr location!';

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: {
          nudgeId: nudge.id,
          type: 'nudge',
        },
        sound: true,
        priority: Notifications.AndroidNotificationPriority.MAX,
        color: '#2e7d32',
        channelId: NUDGR_CHANNEL_ID,
      },
      trigger: null, // Send immediately
    });
  } catch (e) {
    if (__DEV__) {
      console.warn('[local-notif]', e.message);
    }
  }
}
