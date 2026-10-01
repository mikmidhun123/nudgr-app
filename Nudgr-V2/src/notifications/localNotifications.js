import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const NUDGR_ALERTS_CHANNEL_ID = 'nudgr_alerts';
// Android channel sound settings are immutable after first creation. The v2 id
// ensures devices that previously created nudgr_calls with a bad sound get the
// corrected ringtone configuration.
// Bump this whenever incoming-call channel settings change. Android channels
// are immutable after their first creation, so reusing an older id preserves
// a broken sound/vibration setup forever on installed devices.
export const NUDGR_CALLS_CHANNEL_ID = 'nudgr_calls_v3';
export const NUDGR_DEFAULT_CHANNEL_ID = 'default';
export const NUDGR_TEST_CHANNEL_ID = 'nudgr-test';
export const NUDGR_INCOMING_CATEGORY = 'nudgr_incoming';
const INCOMING_NOTIFICATION_KEY_PREFIX = '@nudgr_incoming_notification:';
const incomingNotificationInFlight = new Map();

// Configure the notification handler to ensure notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const id = notification?.request?.identifier;
    console.log('[NOTIFICATION_DEBUG] Notification handler invoked in foreground for ID:', id);
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    };
  },
  handleSuccess: (notificationId) => {
    console.log('[NOTIFICATION_DEBUG] Notification displayed successfully, ID:', notificationId);
  },
  handleError: (notificationId, error) => {
    console.error('[NOTIFICATION_DEBUG] Notification handler error for ID:', notificationId, error);
  },
});

/**
 * Checks and requests notification permissions across Android and iOS.
 * For Android 13+ (API 33+), requests POST_NOTIFICATIONS runtime grant.
 * @returns {Promise<{granted: boolean, status: string, details?: any}>}
 */
export async function checkAndRequestNotificationPermissions() {
  try {
    const current = await Notifications.getPermissionsAsync();
    console.log(`[NOTIFICATION_TEST] Permission status: ${current.status}`);
    console.log('[NOTIFICATION_DEBUG] Permission status check:', current.status, 'granted:', current.granted);

    if (current.granted || current.status === 'granted') {
      return { granted: true, status: current.status, details: current };
    }

    console.log('[NOTIFICATION_DEBUG] Requesting notification permissions...');
    const requested = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
      android: {},
    });

    const isGranted = requested.granted || requested.status === 'granted';
    console.log(`[NOTIFICATION_TEST] Permission request result: ${requested.status}`);
    console.log('[NOTIFICATION_DEBUG] Permission request result:', requested.status, 'granted:', isGranted);

    return {
      granted: isGranted,
      status: requested.status,
      details: requested,
    };
  } catch (e) {
    console.error('[NOTIFICATION_DEBUG] Error checking/requesting notification permissions:', e.message);
    return { granted: false, status: 'error', error: e.message };
  }
}

/**
 * Initializes and verifies the dedicated Android Notification Channels.
 */
export async function setupNotificationChannels() {
  if (Platform.OS === 'android') {
    try {
      // Channel 0: Dedicated test channel
      console.log('[NOTIFICATION_TEST] Creating channel');
      await Notifications.setNotificationChannelAsync(NUDGR_TEST_CHANNEL_ID, {
        name: 'Nudgr Test',
        description: 'Dedicated test notification channel for delivery verification',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: '#2e7d32',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
      });
      console.log('[NOTIFICATION_TEST] Channel created');
      console.log(`[NOTIFICATION_TEST] Channel ID: ${NUDGR_TEST_CHANNEL_ID}`);

      // Channel 1: High-priority regular alerts (default sound)
      await Notifications.setNotificationChannelAsync(NUDGR_ALERTS_CHANNEL_ID, {
        name: 'Nudgr Alerts',
        description: 'Location arrival nudges and reminders from your connections',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: '#2e7d32',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
      });

      // Channel 2: Call-style incoming alerts with custom ringtone
      await Notifications.setNotificationChannelAsync(NUDGR_CALLS_CHANNEL_ID, {
        name: 'Nudgr Incoming Calls',
        description: 'Incoming Nudgr call-like alerts with ringtone',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 800, 200, 800],
        lightColor: '#2e7d32',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        sound: 'ringtone.mp3',
        enableVibrate: true,
        showBadge: true,
      });

      // Channel 3: Fallback default channel
      await Notifications.setNotificationChannelAsync(NUDGR_DEFAULT_CHANNEL_ID, {
        name: 'Nudgr Default',
        description: 'General system and test notifications',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#2e7d32',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
      });

      const channels = await Notifications.getNotificationChannelsAsync();
      const channelIds = channels.map((c) => c.id);
      console.log('[NOTIFICATION_DEBUG] Channels created and verified:', channelIds.join(', '));
    } catch (e) {
      console.error('[NOTIFICATION_DEBUG] Channel creation failed:', e.message);
    }
  }

  // Define notification category with Answer/Decline actions
  try {
    await Notifications.setNotificationCategoryAsync(NUDGR_INCOMING_CATEGORY, [
      {
        identifier: 'ANSWER',
        buttonTitle: 'Answer',
        options: {
          opensAppToForeground: true,
        },
      },
      {
        identifier: 'DECLINE',
        buttonTitle: 'Decline',
        options: {
          // Foregrounding ensures the response handler can clear the
          // notification/state even when Android reclaimed the app process.
          opensAppToForeground: true,
        },
      },
    ]);
    console.log('[NOTIFICATION_DEBUG] Notification category initialized:', NUDGR_INCOMING_CATEGORY);
  } catch (e) {
    console.warn('[NOTIFICATION_DEBUG] Category setup error:', e.message);
  }
}

/**
 * Displays a local Heads-Up Notification when a Nudgr is triggered.
 * @param {object} nudge The Nudge document data.
 * @returns {Promise<string|null>} Notification identifier
 */
export async function showLocalNudgeNotification(nudge) {
  if (!nudge || !nudge.id) {
    console.warn('[NOTIFICATION_DEBUG] showLocalNudgeNotification called without valid nudge data');
    return null;
  }

  const senderName = nudge.senderName || 'Someone';
  const title = `Nudgr from ${senderName}`;
  const body = nudge.message || 'You arrived at your Nudgr location!';

  console.log('[NOTIFICATION_DEBUG] Scheduling local nudge notification for:', nudge.id, 'title:', title);

  try {
    const perm = await checkAndRequestNotificationPermissions();
    if (!perm.granted) {
      console.warn('[NOTIFICATION_DEBUG] Cannot show local notification: permission denied');
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: {
          nudgeId: nudge.id,
          type: 'nudge',
        },
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
        color: '#2e7d32',
        channelId: NUDGR_ALERTS_CHANNEL_ID,
      },
      trigger: null, // Deliver immediately
    });

    console.log('[NOTIFICATION_DEBUG] Local notification scheduled successfully. Notification ID:', id);
    return id;
  } catch (e) {
    console.error('[NOTIFICATION_DEBUG] Failed to schedule local nudge notification:', e.message, e);
    return null;
  }
}

/** A sender-side proof that Android delivered an OS geofence ENTER event. */
export async function showGeofenceEnterNotification({ regionId, enteredAt = new Date() }) {
  const time = enteredAt.toLocaleTimeString();
  try {
    await setupNotificationChannels();
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Nudgr geofence ENTER',
        body: `Entered geofence at ${time}`,
        data: { type: 'nudgr_geofence_enter', regionId, enteredAt: enteredAt.toISOString() },
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
        channelId: NUDGR_TEST_CHANNEL_ID,
      },
      trigger: null,
    });
    console.log(`[NUDGR_GEOFENCE_SELF_TEST] region=${regionId || 'unknown'} notificationId=${id}`);
    return id;
  } catch (error) {
    console.error(`[NUDGR_GEOFENCE_SELF_TEST] result=FAILED error=${error?.message || error}`);
    return null;
  }
}

/**
 * Displays a high-priority incoming call-style notification for a Nudgr.
 * @param {object} params - { nudgeId, senderName, message }
 * @returns {Promise<string|null>} Notification identifier
 */
export async function showIncomingNudgeNotification({ nudgeId, senderName, message }) {
  if (!nudgeId) {
    console.warn('[NOTIFICATION_DEBUG] showIncomingNudgeNotification missing nudgeId');
    return null;
  }

  const name = senderName || 'Someone';
  const title = `Incoming Nudgr from ${name}`;
  const body = message || 'Tap to answer or listen to your voice message';

  const markerKey = `${INCOMING_NOTIFICATION_KEY_PREFIX}${nudgeId}`;
  const existing = await AsyncStorage.getItem(markerKey).catch(() => null);
  if (existing) {
    console.log(`[NUDGR_NOTIFICATION] nudgeId=${nudgeId} result=DEDUPLICATED notificationId=${existing}`);
    return existing;
  }

  if (incomingNotificationInFlight.has(nudgeId)) {
    return incomingNotificationInFlight.get(nudgeId);
  }

  const operation = (async () => {
    try {
      console.log(`[NUDGR_NOTIFICATION] nudgeId=${nudgeId} senderName=${name} result=START`);

      // Ensure channels exist (safe to call in headless context)
      await setupNotificationChannels();

      // NON-BLOCKING permission check: use getPermissionsAsync() instead of
      // requestPermissionsAsync(). In a headless/background JS context (FCM
      // background handler), requestPermissionsAsync() will hang or fail because
      // there is no UI to display the permission dialog. The permission will
      // have been granted when the app was active. If it hasn't been granted,
      // we still attempt to schedule — the OS will silently drop it, which is
      // better than crashing the headless handler.
      try {
        const perm = await Notifications.getPermissionsAsync();
        if (!perm.granted && perm.status !== 'granted') {
          console.warn(`[NUDGR_NOTIFICATION] nudgeId=${nudgeId} result=PERMISSION_NOT_GRANTED (status=${perm.status}), attempting anyway`);
        }
      } catch (permErr) {
        // In headless context, even getPermissionsAsync might throw — proceed anyway
        console.warn(`[NUDGR_NOTIFICATION] nudgeId=${nudgeId} permission check error: ${permErr.message}, proceeding`);
      }

      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: {
            nudgeId,
            senderName: name,
            type: 'nudge_incoming',
          },
          sound: 'ringtone.mp3',
          priority: Notifications.AndroidNotificationPriority.MAX,
          color: '#2e7d32',
          channelId: NUDGR_CALLS_CHANNEL_ID,
          categoryIdentifier: NUDGR_INCOMING_CATEGORY,
          sticky: false,
        },
        trigger: null, // Deliver immediately
      });

      await AsyncStorage.setItem(markerKey, id).catch(() => {});
      console.log(`[NUDGR_NOTIFICATION] nudgeId=${nudgeId} result=SUCCESS notificationId=${id} channel=${NUDGR_CALLS_CHANNEL_ID}`);
      return id;
    } catch (e) {
      console.error(`[NUDGR_NOTIFICATION] nudgeId=${nudgeId} result=FAILED error=${e.message}`);
      return null;
    } finally {
      incomingNotificationInFlight.delete(nudgeId);
    }
  })();

  incomingNotificationInFlight.set(nudgeId, operation);
  return operation;
}

/**
 * Schedules a test notification for developer verification.
 * Adheres strictly to the isolated test protocol:
 * BUTTON -> LOCAL NOTIFICATION -> ANDROID -> VISIBLE NOTIFICATION
 * 
 * @param {number} [seconds=10] Delay in seconds before triggering (0 for immediate)
 * @returns {Promise<{success: boolean, notificationId?: string, error?: string, scheduledTime?: string}>}
 */
export async function scheduleTestNotification(seconds = 10) {
  console.log('[NOTIFICATION_TEST] Button pressed');

  try {
    // 1. Check & ensure permission
    const perm = await checkAndRequestNotificationPermissions();
    if (perm.granted) {
      console.log('[NOTIFICATION_TEST] Permission: granted');
    } else {
      console.log(`[NOTIFICATION_TEST] Permission: ${perm.status || 'denied'}`);
      return {
        success: false,
        error: `Permission is ${perm.status}. Please enable Notifications in Android Settings for Nudgr.`,
      };
    }

    // 2. Ensure test channel exists
    await setupNotificationChannels();
    console.log(`[NOTIFICATION_TEST] Channel: ${NUDGR_TEST_CHANNEL_ID}`);

    // 3. Build trigger & time string
    const isImmediate = !seconds || seconds <= 0;
    const targetDate = new Date(Date.now() + (isImmediate ? 0 : seconds * 1000));
    const timeStr = targetDate.toLocaleTimeString();
    console.log(`[NOTIFICATION_TEST] Scheduling for: ${timeStr}`);

    const trigger = isImmediate
      ? null
      : {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: Math.max(1, Math.round(seconds)),
          repeats: false,
          channelId: NUDGR_TEST_CHANNEL_ID,
        };

    // 4. Schedule notification
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Nudgr',
        body: 'This is a notification system test.',
        data: {
          test: true,
          scheduledAt: Date.now(),
          delaySeconds: seconds,
          channelId: NUDGR_TEST_CHANNEL_ID,
        },
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
        color: '#2e7d32',
        channelId: NUDGR_TEST_CHANNEL_ID,
      },
      trigger,
    });

    console.log(`[NOTIFICATION_TEST] Notification ID: ${notificationId}`);
    console.log('[NOTIFICATION_TEST] Scheduling SUCCESS');

    return {
      success: true,
      notificationId,
      delaySeconds: seconds,
      scheduledTime: timeStr,
    };
  } catch (e) {
    console.error(`[NOTIFICATION_TEST] Scheduling FAILED: ${e.message}`);
    return {
      success: false,
      error: e.message || 'Failed to schedule test notification',
    };
  }
}

/**
 * Gathers complete notification diagnostics for display and debugging.
 */
export async function getNotificationDiagnostics() {
  try {
    const permissions = await Notifications.getPermissionsAsync();
    let channels = [];
    if (Platform.OS === 'android') {
      channels = await Notifications.getNotificationChannelsAsync();
    }
    return {
      platform: Platform.OS,
      osVersion: Platform.Version,
      permissionStatus: permissions.status,
      permissionGranted: permissions.granted,
      channels: channels.map((c) => ({
        id: c.id,
        name: c.name,
        importance: c.importance,
        sound: c.sound,
      })),
    };
  } catch (e) {
    return {
      platform: Platform.OS,
      error: e.message,
    };
  }
}

/**
 * Dismisses the incoming Nudgr notification.
 * @param {string} [nudgeId]
 */
export async function dismissIncomingNudgeNotification(nudgeId) {
  try {
    const markerKey = nudgeId ? `${INCOMING_NOTIFICATION_KEY_PREFIX}${nudgeId}` : null;
    const notificationId = markerKey ? await AsyncStorage.getItem(markerKey) : null;
    if (notificationId) {
      await Notifications.dismissNotificationAsync(notificationId);
      await AsyncStorage.removeItem(markerKey);
      console.log(`[NOTIFICATION_DEBUG] Dismissed incoming notification nudgeId=${nudgeId}`);
    } else if (!nudgeId) {
      await Notifications.dismissAllNotificationsAsync();
      const keys = await AsyncStorage.getAllKeys();
      await AsyncStorage.multiRemove(keys.filter((key) => key.startsWith(INCOMING_NOTIFICATION_KEY_PREFIX)));
      console.log('[NOTIFICATION_DEBUG] Dismissed all incoming notifications');
    }
  } catch (e) {
    console.warn('[NOTIFICATION_DEBUG] Error dismissing notifications:', e.message);
  }
}

/**
 * Updates the incoming notification to show it's been handled.
 */
export async function updateIncomingNotification(nudgeId, action) {
  if (!nudgeId) return;
  await dismissIncomingNudgeNotification(nudgeId);
}

/**
 * Schedules an exact time alarm for a time-scheduled Nudgr.
 * Cancels any existing scheduled alarm for this Nudgr first to prevent duplicate notifications.
 * Implements full [TIME_TRIGGER_DEBUG] diagnostic logging.
 * 
 * @param {object} nudge - The Nudgr document
 * @returns {Promise<{success: boolean, notificationId?: string, error?: string, targetTime?: string, secondsInFuture?: number}>}
 */
export async function scheduleNudgeTimeAlarm(nudge) {
  if (!nudge || !nudge.id) {
    console.warn('[TIME_TRIGGER_DEBUG] scheduleNudgeTimeAlarm called without valid nudge or nudge.id');
    return null;
  }

  console.log('[TIME_TRIGGER_DEBUG] Nudgr created');
  console.log(`[TIME_TRIGGER_DEBUG] Nudgr ID: ${nudge.id}`);

  const triggerType = nudge.schedule?.type || (nudge.schedule?.afterHour != null ? 'TIME_AFTER_HOUR' : 'TIME');
  console.log(`[TIME_TRIGGER_DEBUG] Trigger type: ${triggerType}`);

  try {
    // 1. Cancel previous schedule for this specific nudge to avoid duplicates
    await cancelNudgeAlarm(nudge.id);

    // 2. Determine trigger time from schedule
    const s = nudge.schedule;
    if (!s) {
      console.warn(`[TIME_TRIGGER_DEBUG] Nudgr ${nudge.id} has no schedule object!`);
      return null;
    }

    let targetDate = null;
    let configuredTimeStr = '';
    const now = new Date();
    const nowMs = now.getTime();

    if (typeof s.targetTimestamp === 'number' && s.targetTimestamp > 0) {
      targetDate = new Date(s.targetTimestamp);
      configuredTimeStr = `targetTimestamp: ${s.targetTimestamp} (${targetDate.toLocaleTimeString()})`;
    } else if (typeof s.delaySeconds === 'number' && s.delaySeconds > 0) {
      targetDate = new Date(nowMs + s.delaySeconds * 1000);
      configuredTimeStr = `+${s.delaySeconds}s from creation (${targetDate.toLocaleTimeString()})`;
    } else if (typeof s.activeAfter === 'number' && s.activeAfter > 0) {
      targetDate = new Date(s.activeAfter);
      configuredTimeStr = `activeAfter: ${s.activeAfter} (${targetDate.toLocaleTimeString()})`;
    } else if (typeof s.afterHour === 'number') {
      const afterMinute = typeof s.afterMinute === 'number' ? s.afterMinute : 0;
      configuredTimeStr = `${s.afterHour}:${afterMinute < 10 ? '0' : ''}${afterMinute} (${s.afterTimeText || ''})`;
      targetDate = new Date();
      targetDate.setHours(s.afterHour, afterMinute, 0, 0);

      // Check if this time has already passed today
      if (targetDate.getTime() <= nowMs) {
        // Shifting to tomorrow
        targetDate.setDate(targetDate.getDate() + 1);
        console.warn(`[TIME_TRIGGER_DEBUG] NOTE: Target time ${configuredTimeStr} already passed today. Scheduled for TOMORROW at: ${targetDate.toISOString()}`);
      }
    }

    console.log(`[TIME_TRIGGER_DEBUG] Configured trigger time: ${configuredTimeStr || 'unspecified'}`);
    console.log(`[TIME_TRIGGER_DEBUG] Current time: ${now.toLocaleTimeString()} (${now.toISOString()})`);

    if (!targetDate) {
      console.error(`[TIME_TRIGGER_DEBUG] Schedule ERROR: Unable to calculate target date from schedule:`, JSON.stringify(s));
      return null;
    }

    console.log(`[TIME_TRIGGER_DEBUG] Target time: ${targetDate.toLocaleTimeString()} (${targetDate.toISOString()})`);

    const isFuture = targetDate.getTime() > nowMs;
    const secondsInFuture = Math.max(1, Math.round((targetDate.getTime() - nowMs) / 1000));
    console.log(`[TIME_TRIGGER_DEBUG] Whether trigger time is actually in the future: ${isFuture ? 'YES' : 'NO'} (${secondsInFuture}s remaining)`);

    if (!isFuture) {
      console.error('[TIME_TRIGGER_DEBUG] Schedule ERROR: Target time is in the past! Alarm will not fire.');
      return null;
    }

    // 3. Check notification permissions
    const perm = await checkAndRequestNotificationPermissions();
    if (!perm.granted) {
      console.warn('[TIME_TRIGGER_DEBUG] Cannot schedule time alarm: Notification permission denied!');
      return null;
    }

    // 4. Ensure channels exist
    await setupNotificationChannels();

    const senderName = nudge.senderName || 'Someone';
    const title = `⏰ Nudgr Reminder from ${senderName}`;
    const body = nudge.message || 'It is time for your Nudgr reminder!';

    console.log('[TIME_TRIGGER_DEBUG] Scheduling notification...');

    // 5. Schedule via AlarmManager (TIME_INTERVAL with exact secondsInFuture for 100% Android background reliability)
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: {
          nudgeId: nudge.id,
          type: 'nudge_time_alarm',
          scheduledAt: nowMs,
          targetTime: targetDate.getTime(),
          delaySeconds: secondsInFuture,
        },
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
        color: '#2e7d32',
        channelId: NUDGR_TEST_CHANNEL_ID,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsInFuture,
        repeats: false,
        channelId: NUDGR_TEST_CHANNEL_ID,
      },
    });

    console.log(`[TIME_TRIGGER_DEBUG] Notification ID: ${notificationId}`);
    console.log('[TIME_TRIGGER_DEBUG] Trigger successfully registered');
    console.log('[TIME_TRIGGER_DEBUG] Schedule SUCCESS');

    // 6. Verify underlying trigger immediately via getAllScheduledNotificationsAsync
    const scheduledList = await Notifications.getAllScheduledNotificationsAsync();
    console.log(`[TIME_TRIGGER_DEBUG] Scheduled notifications: ${scheduledList.length} total in OS registry`);
    const matching = scheduledList.filter(
      (item) => item.identifier === notificationId || item.content?.data?.nudgeId === nudge.id
    );
    console.log(`[TIME_TRIGGER_DEBUG] Matching Nudgr trigger found: ${matching.length > 0 ? 'YES' : 'NO'}`);

    if (matching.length > 0) {
      matching.forEach((m) => {
        console.log(`[TIME_TRIGGER_DEBUG] Verified OS Trigger: ID=${m.identifier}, TriggerType=${m.trigger?.type || 'interval'}, Title="${m.content?.title}"`);
      });
    }

    return {
      success: true,
      notificationId,
      targetTime: targetDate.toLocaleTimeString(),
      targetTimestamp: targetDate.getTime(),
      secondsInFuture,
      scheduledCount: scheduledList.length,
      matchingFound: matching.length > 0,
    };
  } catch (e) {
    console.error(`[TIME_TRIGGER_DEBUG] Any scheduling error: ${e.message}`, e);
    return {
      success: false,
      error: e.message,
    };
  }
}

/**
 * Creates and registers a self-contained, pure time-based test Nudgr.
 * Zero dependency on GPS, geofencing, radius, another user, or Firebase Cloud Functions.
 * 
 * @param {object} params
 * @param {string} [params.message='Time trigger test'] - Test message
 * @param {number} [params.seconds=60] - Delay in seconds (e.g. 60 for 1 min, 120 for 2 min)
 * @returns {Promise<{success: boolean, nudgeId: string, notificationId?: string, error?: string, targetTime?: string}>}
 */
export async function createAndScheduleTimeTestNudge({ message = 'Time trigger test', seconds = 60 } = {}) {
  const nudgeId = `test_time_${Date.now()}`;
  const now = Date.now();
  const targetTimestamp = now + seconds * 1000;

  const testNudge = {
    id: nudgeId,
    senderName: 'Nudgr Time Test',
    message: message.trim() || 'Time trigger test',
    schedule: {
      type: 'TIME',
      delaySeconds: seconds,
      targetTimestamp,
    },
    createdAt: now,
    enabled: true,
    isLocalTest: true,
  };

  const res = await scheduleNudgeTimeAlarm(testNudge);

  return {
    ...res,
    nudgeId,
    testNudge,
  };
}

/**
 * Verifies all scheduled notifications in the OS registry and checks if a specific or any Nudgr trigger matches.
 * 
 * @param {string} [nudgeId] - Optional Nudgr ID to filter
 * @returns {Promise<{total: number, matchingCount: number, matchingFound: boolean, items: Array}>}
 */
export async function verifyScheduledNudgeAlarms(nudgeId = null) {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    console.log(`[TIME_TRIGGER_DEBUG] Scheduled notifications: ${scheduled.length} total active in Android OS`);

    const matching = nudgeId
      ? scheduled.filter((item) => item.content?.data?.nudgeId === nudgeId)
      : scheduled.filter((item) => item.content?.data?.type === 'nudge_time_alarm');

    const found = matching.length > 0;
    console.log(`[TIME_TRIGGER_DEBUG] Matching Nudgr trigger found: ${found ? 'YES' : 'NO'}`);

    matching.forEach((item, idx) => {
      console.log(`[TIME_TRIGGER_DEBUG] Alarm #${idx + 1}: ID=${item.identifier}, NudgeID=${item.content?.data?.nudgeId}, Seconds=${item.trigger?.seconds || item.content?.data?.delaySeconds}, Title="${item.content?.title}"`);
    });

    return {
      total: scheduled.length,
      matchingCount: matching.length,
      matchingFound: found,
      items: matching.map((m) => ({
        id: m.identifier,
        nudgeId: m.content?.data?.nudgeId,
        title: m.content?.title,
        body: m.content?.body,
        trigger: m.trigger,
      })),
    };
  } catch (e) {
    console.error(`[TIME_TRIGGER_DEBUG] Any scheduling error during verification: ${e.message}`);
    return {
      total: 0,
      matchingCount: 0,
      matchingFound: false,
      items: [],
      error: e.message,
    };
  }
}

/**
 * Cancels all scheduled local notifications for a specific Nudgr ID.
 * 
 * @param {string} nudgeId - The Nudgr ID
 */
export async function cancelNudgeAlarm(nudgeId) {
  if (!nudgeId) return;

  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const matching = scheduled.filter(
      (item) => item.content?.data?.nudgeId === nudgeId
    );

    for (const item of matching) {
      console.log(`[NOTIFICATION_DEBUG] Cancelling scheduled notification ${item.identifier} for Nudgr ${nudgeId}`);
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
  } catch (e) {
    console.warn('[NOTIFICATION_DEBUG] Error cancelling nudge alarms:', e.message);
  }
}

/**
 * Synchronizes scheduled local notifications for an array of Nudgrs.
 * Ensures enabled time-based nudges have alarms and disabled ones are cancelled.
 * 
 * @param {Array} nudges - List of Nudgr documents
 * @param {function} isNudgeActiveFn - Function that checks if a Nudgr is active
 */
export async function syncAllNudgeAlarms(nudges = [], isNudgeActiveFn) {
  if (!Array.isArray(nudges)) return;

  console.log(`[NOTIFICATION_DEBUG] Synchronizing alarms for ${nudges.length} Nudgrs`);

  for (const nudge of nudges) {
    const active = isNudgeActiveFn ? isNudgeActiveFn(nudge) : nudge.enabled !== false;
    if (active && nudge.schedule) {
      await scheduleNudgeTimeAlarm(nudge);
    } else {
      await cancelNudgeAlarm(nudge.id);
    }
  }
}
