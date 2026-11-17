import { persistSenderPlan, clearSenderPlan } from './scheduledSender';
import { scheduleAllows, canTriggerByRepeatPolicy, REPEAT_MODE } from './geoUtils';
import * as Location from 'expo-location';
import {
  registerGeofencesForNudges,
  stopSenderGeofences,
  evaluateSenderNudges,
} from './backgroundGeofence';
import {
  subscribeSentNudges,
  NUDGE_STATUS,
  isNudgeActive,
} from '../db/nudges';

export * from './geoUtils';

/**
 * Starts the geofence monitor for active Nudgrs sent by this device's user.
 * Uses OS-level geofencing (expo-location startGeofencingAsync) for background,
 * plus a foreground position watcher (watchPositionAsync) for real-time responsiveness
 * when moving while the app is open, and an immediate initial one-shot evaluation
 * so that stationary users or users already inside the radius trigger without delay.
 */
export function startTriggerEngine({ uid, onStatus }) {
  let stopped = false;
  let fgWatcherSub = null;
  let sentNudges = [];
  let syncInProgress = false;
  let pendingSync = false;
  let lastEligibilityKey = '';

  const isStatusCandidate = (nudge) => {
    const mode = nudge?.repeatMode || REPEAT_MODE.ONCE;
    if (mode === REPEAT_MODE.ONCE) {
      return nudge?.status === NUDGE_STATUS.ACTIVE || nudge?.status === NUDGE_STATUS.SCHEDULED;
    }
    return nudge?.status !== NUDGE_STATUS.CANCELLED;
  };

  const eligible = (nudge) =>
    isStatusCandidate(nudge) &&
    isNudgeActive(nudge) &&
    scheduleAllows(nudge) &&
    canTriggerByRepeatPolicy(nudge, new Date(), false);

  const eligibilityKey = () =>
    sentNudges
      .filter(eligible)
      .map((nudge) => nudge.id)
      .sort()
      .join('|');

  console.log(`[NUDGR_GEOFENCE_REGISTER] Starting sender geofence engine currentUserUid=${uid}`);

  const startForegroundWatcher = async (activeNudges) => {
    if (fgWatcherSub) {
      fgWatcherSub.remove();
      fgWatcherSub = null;
    }
    if (stopped || !activeNudges || activeNudges.length === 0) return;

    try {
      const fgPerm = await Location.getForegroundPermissionsAsync();
      if (stopped || fgPerm.status !== 'granted') return;

      const watcher = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          mayShowUserSettingsDialog: false,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        async (loc) => {
          if (stopped || !loc?.coords) return;
          console.log(`[REAL_LOCATION]\ntimestamp=${new Date(loc.timestamp || Date.now()).toISOString()}\nlatitude=${loc.coords.latitude}\nlongitude=${loc.coords.longitude}\naccuracy=${loc.coords.accuracy}\nevent=FOREGROUND_GPS_UPDATE\nregionId=none\ntransition=NONE`);
          await evaluateSenderNudges(loc.coords);
        }
      );
      if (stopped) {
        watcher.remove();
        return;
      }
      fgWatcherSub = watcher;
      console.log('[GEOFENCE_DEBUG] Foreground position watcher active for real-time tracking');
    } catch (err) {
      console.warn('[GEOFENCE_DEBUG] Could not start foreground position watcher:', err.message);
    }
  };

  const syncGeofences = async () => {
    if (stopped) return;

    await persistSenderPlan(uid, sentNudges);
    if (stopped) return;

    // Only the sender's device owns the physical geofence for a Nudgr.
    const allNudges = sentNudges.filter((n) => n?.id && n.senderUid === uid);
    lastEligibilityKey = eligibilityKey();

    // Register geofences for any enabled Nudgr that is eligible or repeating (so EXIT transitions are tracked too)
    const activeNudges = allNudges.filter(
      (n) =>
        isStatusCandidate(n) &&
        isNudgeActive(n) &&
        scheduleAllows(n) &&
        typeof n.triggerLatitude === 'number' &&
        typeof n.triggerLongitude === 'number' &&
        typeof n.radiusKm === 'number'
    );

    console.log(
      `[NUDGR_GEOFENCE_REGISTER] Sync currentUserUid=${uid} sent=${allNudges.length} active=${activeNudges.length}`
    );

    if (activeNudges.length === 0) {
      if (onStatus) onStatus('no-active-nudges');
      if (fgWatcherSub) {
        fgWatcherSub.remove();
        fgWatcherSub = null;
      }
      await stopSenderGeofences(uid);
      return;
    }

    const result = await registerGeofencesForNudges(activeNudges, () => !stopped);
    if (stopped) return;
    if (result.success > 0) {
      console.log(`[NUDGR_GEOFENCE_REGISTER] currentUserUid=${uid} registered=${result.success}`);
      if (onStatus) onStatus('monitoring-geofence', result.success);
    } else if (onStatus) {
      console.warn('[GEOFENCE_DEBUG] Geofence registration failed:', result.reason);
      onStatus('location-unavailable', result.reason);
    }

    // Start foreground position watcher for real-time responsiveness
    await startForegroundWatcher(activeNudges);

    // Immediately evaluate current position against active nudges
    (async () => {
      try {
        let initialLoc = null;
        try {
          initialLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, mayShowUserSettingsDialog: false });
        } catch (_) {
          initialLoc = await Location.getLastKnownPositionAsync({ maxAge: 60000, requiredAccuracy: 200 });
        }
        if (!stopped && initialLoc?.coords) {
          console.log(
            `[TRIGGER_DIAG] Immediate initial location evaluation on engine start:\nlat=${initialLoc.coords.latitude}, lon=${initialLoc.coords.longitude}`
          );
          await evaluateSenderNudges(initialLoc.coords);
        }
      } catch (err) {
        console.warn('[TRIGGER_DIAG] Initial position check error:', err.message);
      }
    })();
  };

  const queueSync = async () => {
    if (stopped) return;
    if (syncInProgress) {
      pendingSync = true;
      return;
    }
    syncInProgress = true;
    try {
      await syncGeofences();
    } finally {
      syncInProgress = false;
      if (pendingSync && !stopped) {
        pendingSync = false;
        await queueSync();
      }
    }
  };

  const unsubSent = subscribeSentNudges(
    uid,
    async (nudges) => {
      if (stopped) return;
      sentNudges = nudges || [];
      await queueSync();
    },
    (err) => console.warn('[triggerEngine] sent nudges subscription error:', err?.message)
  );

  const clock = setInterval(() => {
    if (!stopped && lastEligibilityKey !== eligibilityKey()) queueSync().catch(() => {});
  }, 30000);

  return function stop() {
    clearInterval(clock);
    stopped = true;
    console.log('[GEOFENCE_DEBUG] Stopping trigger engine');
    if (fgWatcherSub) {
      fgWatcherSub.remove();
      fgWatcherSub = null;
    }
    if (unsubSent) unsubSent();
    return Promise.all([stopSenderGeofences(uid), clearSenderPlan(uid)]);
  };
}
