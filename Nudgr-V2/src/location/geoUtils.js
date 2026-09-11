/**
 * Pure calculation utilities for location, geofencing, schedules, and cooldowns.
 * Zero external dependencies — completely free of circular module imports.
 */

export const RADIUS_MIN_KM = 2.5;
export const RADIUS_MAX_KM = 10.0;
export const RADIUS_DEFAULT_KM = 5.0;
export const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes cooldown per Nudgr

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
 * Checks if a Nudgr is currently within its trigger cooldown window.
 * Default cooldown is 30 minutes.
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
 * Returns true when the Nudgr's schedule permits triggering at the current time.
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
