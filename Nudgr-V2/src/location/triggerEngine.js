import * as Location from 'expo-location';
import {
  registerGeofencesForNudges,
  stopGeofences,
  evaluateSenderNudges,
} from './backgroundGeofence';
import { subscribeSentNudges, NUDGE_STATUS, isNudgeActive } from '../db/nudges';

export * from './geoUtils';

/**
 * Starts the geofence monitor for the SENDER'S active Nudgrs.
 * Uses OS-level geofencing (expo-location startGeofencingAsync) for background,
 * plus a foreground position watcher (watchPositionAsync) for real-time responsiveness
 * when moving while the app is open, and an immediate initial one-shot evaluation
 * so that stationary senders or senders already inside the radius trigger without delay.
 */
export function startTriggerEngine({ uid, onStatus }) {
  let stopped = false;
  let fgWatcherSub = null;
  console.log('[GEOFENCE_DEBUG] Starting trigger engine for user:', uid);

  const startForegroundWatcher = async (activeNudges) => {
    if (fgWatcherSub) {
      fgWatcherSub.remove();
      fgWatcherSub = null;
    }
    if (stopped || !activeNudges || activeNudges.length === 0) return;

    try {
      const fgPerm = await Location.getForegroundPermissionsAsync();
      if (fgPerm.status !== 'granted') return;

      fgWatcherSub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        async (loc) => {
          if (stopped || !loc?.coords) return;
          console.log(`[REAL_LOCATION]\ntimestamp=${new Date(loc.timestamp || Date.now()).toISOString()}\nlatitude=${loc.coords.latitude}\nlongitude=${loc.coords.longitude}\naccuracy=${loc.coords.accuracy}\nevent=FOREGROUND_GPS_UPDATE\nregionId=none\ntransition=NONE`);
          await evaluateSenderNudges(loc.coords);
        }
      );
      console.log('[GEOFENCE_DEBUG] Foreground position watcher active for real-time tracking');
    } catch (err) {
      console.warn('[GEOFENCE_DEBUG] Could not start foreground position watcher:', err.message);
    }
  };

  // Subscribe to sender's active nudges and register geofences
  const unsub = subscribeSentNudges(uid, async (nudges) => {
    if (stopped) return;

    // Filter for ACTIVE or SCHEDULED nudges that are currently enabled (isNudgeActive)
    const activeNudges = nudges.filter(
      n => (n.status === NUDGE_STATUS.ACTIVE || n.status === NUDGE_STATUS.SCHEDULED) &&
           isNudgeActive(n) &&
           typeof n.triggerLatitude === 'number' &&
           typeof n.triggerLongitude === 'number' &&
           typeof n.radiusKm === 'number'
    );

    console.log(`[NUDGR_DIAG] Sent nudges subscription updated. Total: ${nudges.length}, Active & Enabled for geofencing: ${activeNudges.length}`);

    if (activeNudges.length === 0) {
      if (onStatus) onStatus('no-active-nudges');
      if (fgWatcherSub) {
        fgWatcherSub.remove();
        fgWatcherSub = null;
      }
      await stopGeofences();
      return;
    }

    const result = await registerGeofencesForNudges(activeNudges);
    if (result.success > 0) {
      console.log('[GEOFENCE_DEBUG] Geofence monitoring active for', result.success, 'nudges');
      if (onStatus) onStatus('monitoring-geofence', result.success);
    } else if (onStatus) {
      console.warn('[GEOFENCE_DEBUG] Geofence registration failed:', result.reason);
      onStatus('location-unavailable', result.reason);
    }

    // Start foreground position watcher for real-time responsiveness
    await startForegroundWatcher(activeNudges);

    // Immediately evaluate current position against active nudges
    // (Essential for when sender is already inside radius or stationary at creation)
    (async () => {
      try {
        let initialLoc = null;
        try {
          initialLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        } catch (_) {
          initialLoc = await Location.getLastKnownPositionAsync();
        }
        if (!stopped && initialLoc?.coords) {
          console.log(`[TRIGGER_DIAG] Immediate initial location evaluation on engine start:\nlat=${initialLoc.coords.latitude}, lon=${initialLoc.coords.longitude}`);
          await evaluateSenderNudges(initialLoc.coords);
        }
      } catch (err) {
        console.warn('[TRIGGER_DIAG] Initial position check error:', err.message);
      }
    })();
  });

  return function stop() {
    stopped = true;
    console.log('[GEOFENCE_DEBUG] Stopping trigger engine');
    if (fgWatcherSub) {
      fgWatcherSub.remove();
      fgWatcherSub = null;
    }
    unsub();
    stopGeofences();
  };
}
