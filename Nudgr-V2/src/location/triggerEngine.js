import {
  registerGeofencesForNudges,
  stopGeofences,
} from './backgroundGeofence';
import { subscribeSentNudges, NUDGE_STATUS, isNudgeActive } from '../db/nudges';

export const RADIUS_MIN_KM = 2.5;
export const RADIUS_MAX_KM = 10.0;
export const RADIUS_DEFAULT_KM = 5.0;
export const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes cooldown per Nudgr

/**
 * Checks if a Nudgr is currently within its trigger cooldown window.
 * Default cooldown is 30 minutes.
 *
 * @param {object} nudge - The Nudgr document
 * @param {number} [cooldownMs] - Cooldown duration in milliseconds (default: 30 minutes)
 * @param {number} [nowMs] - Current epoch time in milliseconds
 * @returns {boolean}
 */
export function isCooldownActive(nudge, cooldownMs = DEFAULT_COOLDOWN_MS, nowMs = Date.now()) {
  if (!nudge) return false;
  const lastTrigger =
    nudge.lastTriggeredAt?.toMillis?.() ||
    (typeof nudge.lastTriggeredAt === 'number' ? nudge.lastTriggeredAt : null) ||
    nudge.triggeredAt?.toMillis?.() ||
    (typeof nudge.triggeredAt === 'number' ? nudge.triggeredAt : null);

  if (!lastTrigger) return false;
  return nowMs - lastTrigger < cooldownMs;
}

/**
 * Calculates the great-circle distance between two GPS coordinates in meters
 * using the Haversine formula. Pure JS, zero external dependencies.
 */
export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (
    typeof lat1 !== 'number' ||
    typeof lon1 !== 'number' ||
    typeof lat2 !== 'number' ||
    typeof lon2 !== 'number'
  ) {
    return Infinity;
  }
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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
    !coords ||
    typeof coords.latitude !== 'number' ||
    typeof coords.longitude !== 'number' ||
    typeof nudge?.triggerLatitude !== 'number' ||
    typeof nudge?.triggerLongitude !== 'number' ||
    typeof nudge?.radiusKm !== 'number'
  ) {
    return false;
  }
  const distance = calculateDistanceMeters(
    coords.latitude,
    coords.longitude,
    nudge.triggerLatitude,
    nudge.triggerLongitude
  );
  return distance <= nudge.radiusKm * 1000;
}

/**
 * Starts the geofence monitor for the SENDER'S active Nudgrs.
 * Uses OS-level geofencing (expo-location startGeofencingAsync).
 */
export function startTriggerEngine({ uid, onStatus }) {
  let stopped = false;
  console.log('[GEOFENCE_DEBUG] Starting trigger engine for user:', uid);

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

    console.log('[GEOFENCE_DEBUG] Sent nudges subscription updated. Total:', nudges.length, 'Active & Enabled for geofencing:', activeNudges.length);

    if (activeNudges.length === 0) {
      if (onStatus) onStatus('no-active-nudges');
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
  });

  return function stop() {
    stopped = true;
    console.log('[GEOFENCE_DEBUG] Stopping trigger engine');
    unsub();
    stopGeofences();
  };
}
