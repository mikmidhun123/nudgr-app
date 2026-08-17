import * as Location from 'expo-location';
import {
  startBackgroundGeofence,
  stopBackgroundGeofence,
  startForegroundWatch,
} from './backgroundGeofence';

export const RADIUS_MIN_KM = 2.5;
export const RADIUS_MAX_KM = 10.0;
export const RADIUS_DEFAULT_KM = 5.0;

/**
 * Returns true when the Nudgr's schedule permits triggering at the current time.
 * Backward-compatible with:
 *   - afterHour: number (0-23)
 *   - afterMinute: number (0-59)
 *   - activeAfter: number (epoch ms)
 */
export function scheduleAllows(nudge, now = new Date()) {
  const s = nudge.schedule;
  if (!s) return true;

  if (typeof s.activeAfter === 'number' && now.getTime() < s.activeAfter) {
    return false;
  }

  if (typeof s.afterHour === 'number') {
    const afterMinute = typeof s.afterMinute === 'number' ? s.afterMinute : 0;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const targetMinutes = s.afterHour * 60 + afterMinute;
    if (currentMinutes < targetMinutes) {
      return false;
    }
  }

  return true;
}

/**
 * Computes whether the device is within the Nudgr's configured radius.
 * Uses the user-selected radiusKm (radiusKm * 1000 metres).
 */
export function isWithinRadius(nudge, coords) {
  if (
    typeof nudge.triggerLatitude !== 'number' ||
    typeof nudge.triggerLongitude !== 'number' ||
    typeof nudge.radiusKm !== 'number'
  ) {
    return false;
  }
  const distance = Location.distanceBetween(
    { latitude: coords.latitude, longitude: coords.longitude },
    { latitude: nudge.triggerLatitude, longitude: nudge.triggerLongitude }
  );
  return distance <= nudge.radiusKm * 1000;
}

/**
 * Starts the location monitor using Android's background location updates.
 */
export function startTriggerEngine({ uid, onStatus }) {
  let stopped = false;
  let stopWatch = null;

  startBackgroundGeofence()
    .then((ok) => {
      if (stopped) {
        if (ok) stopBackgroundGeofence();
        return;
      }
      if (ok) {
        if (onStatus) onStatus('monitoring-background');
        return;
      }
      startForegroundWatch()
        .then((stop) => {
          if (stopped) {
            if (stop) stop();
            return;
          }
          if (stop) {
            stopWatch = stop;
            if (onStatus) onStatus('monitoring-foreground-only');
          } else if (onStatus) {
            onStatus('location-unavailable');
          }
        })
        .catch(() => {
          if (onStatus) onStatus('location-unavailable');
        });
    })
    .catch(() => {
      if (onStatus) onStatus('location-unavailable');
    });

  return function stop() {
    stopped = true;
    if (stopWatch) {
      try {
        stopWatch();
      } catch (e) {
        if (__DEV__) console.warn('[fg-watch-stop]', e.message);
      }
      stopWatch = null;
    }
    stopBackgroundGeofence();
  };
}
