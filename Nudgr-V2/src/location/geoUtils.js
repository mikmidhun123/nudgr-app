/**
 * Pure calculation utilities for location, geofencing, schedules, repeat policies, and cooldowns.
 * Zero external dependencies — completely free of circular module imports.
 */

export const RADIUS_MIN_KM = 2.5;
export const RADIUS_MAX_KM = 10.0;
export const RADIUS_DEFAULT_KM = 5.0;
export const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes default cooldown
export const EXIT_HYSTERESIS_MIN_METERS = 200; // 200m buffer beyond radius to confirm exit

export const REPEAT_MODE = {
  ONCE: 'once',
  ONCE_PER_DAY: 'once_per_day',
  MULTIPLE_PER_DAY: 'multiple_per_day',
};

/**
 * Formats a Date into 'YYYY-MM-DD' in local calendar time.
 */
export function localDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Computes the integer local calendar day index since Unix epoch,
 * matching Firestore security rules: int((nowMs + tzOffsetMinutes * 60000) / 86400000).
 */
export function localDayIndex(nowMs = Date.now(), tzOffsetMinutes = null) {
  const offsetMin =
    typeof tzOffsetMinutes === 'number' && Number.isFinite(tzOffsetMinutes)
      ? tzOffsetMinutes
      : -new Date(nowMs).getTimezoneOffset();
  return Math.floor((nowMs + offsetMin * 60000) / 86400000);
}

/**
 * Extracts epoch milliseconds from a Firestore Timestamp or numeric timestamp.
 */
export function extractTimestampMs(val) {
  if (!val) return null;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val?.toMillis === 'function') {
    const ms = val.toMillis();
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
  }
  const sec = val?.seconds ?? val?._seconds;
  if (typeof sec === 'number' && Number.isFinite(sec)) {
    const nano = val?.nanoseconds ?? val?._nanoseconds ?? 0;
    return sec * 1000 + Math.floor(nano / 1000000);
  }
  return null;
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
 * Checks if a Nudgr is currently within its trigger cooldown window.
 * Default cooldown is 30 minutes.
 */
export function isCooldownActive(nudge, cooldownMs = DEFAULT_COOLDOWN_MS, nowMs = Date.now()) {
  if (!nudge) return false;
  const lastTrigger =
    extractTimestampMs(nudge.lastTriggeredAt) ||
    extractTimestampMs(nudge.triggeredAt);

  if (!lastTrigger) return false;
  return nowMs - lastTrigger < cooldownMs;
}

/**
 * Returns true when the Nudgr's schedule permits triggering at the current time.
 * Supports:
 * - activeAfter (earliest activation timestamp)
 * - expiresAt (optional expiration timestamp)
 * - startHour/startMinute (or legacy afterHour/afterMinute)
 * - endHour/endMinute (supports both same-day and overnight windows)
 * - daysOfWeek (array of 0=Sun..6=Sat)
 */
export function scheduleAllows(nudge, now = new Date()) {
  if (!nudge) return false;
  const s = nudge.schedule;
  if (!s) return true;

  const d = now instanceof Date ? now : new Date(now);
  const nowMs = d.getTime();

  if (typeof s.activeAfter === 'number' && nowMs < s.activeAfter) {
    return false;
  }

  if (typeof s.expiresAt === 'number' && s.expiresAt > 0 && nowMs >= s.expiresAt) {
    return false;
  }

  const startHour =
    typeof s.startHour === 'number'
      ? s.startHour
      : typeof s.afterHour === 'number'
      ? s.afterHour
      : null;
  const startMinute =
    typeof s.startMinute === 'number'
      ? s.startMinute
      : typeof s.afterMinute === 'number'
      ? s.afterMinute
      : 0;
  const endHour = typeof s.endHour === 'number' ? s.endHour : null;
  const endMinute = typeof s.endMinute === 'number' ? s.endMinute : 59;

  let effectiveDayOfWeek = d.getDay();

  if (startHour !== null) {
    const currentMinutes = d.getHours() * 60 + d.getMinutes();
    const startMinutes = startHour * 60 + startMinute;

    if (endHour !== null) {
      const endMinutes = endHour * 60 + endMinute;
      if (endMinutes >= startMinutes) {
        // Same-day window (e.g. 09:00 to 18:00)
        if (currentMinutes < startMinutes || currentMinutes > endMinutes) {
          return false;
        }
      } else {
        // Overnight window (e.g. 22:00 to 06:00)
        if (currentMinutes < startMinutes && currentMinutes > endMinutes) {
          return false;
        }
        // Post-midnight spillover belongs to the previous day's schedule
        if (currentMinutes <= endMinutes) {
          effectiveDayOfWeek = (d.getDay() + 6) % 7;
        }
      }
    } else if (currentMinutes < startMinutes) {
      return false;
    }
  }

  if (Array.isArray(s.daysOfWeek) && s.daysOfWeek.length > 0) {
    if (!s.daysOfWeek.includes(effectiveDayOfWeek)) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluates whether a Nudgr's repeat preference permits triggering right now.
 *
 * @param {object} nudge - The Nudgr document
 * @param {Date} [now=new Date()] - Current time
 * @param {boolean} [insideZone=false] - Whether the sender is already recorded inside the geofence
 * @returns {boolean}
 */
export function canTriggerByRepeatPolicy(nudge, now = new Date(), insideZone = false) {
  if (!nudge) return false;
  if (nudge.status === 'cancelled') return false;

  const d = now instanceof Date ? now : new Date(now);
  const nowMs = d.getTime();
  const mode = nudge.repeatMode || REPEAT_MODE.ONCE;

  if (mode === REPEAT_MODE.ONCE) {
    if (['triggered', 'completed', 'cancelled'].includes(nudge.status)) {
      return false;
    }
    return !isCooldownActive(nudge, DEFAULT_COOLDOWN_MS, nowMs);
  }

  if (mode === REPEAT_MODE.ONCE_PER_DAY) {
    const todayStr = localDateKey(d);
    if (nudge.lastTriggeredDate === todayStr) {
      return false;
    }
    const todayIdx = localDayIndex(nowMs, nudge.timezoneOffsetMinutes);
    if (typeof nudge.lastTriggeredDayIndex === 'number' && nudge.lastTriggeredDayIndex === todayIdx) {
      return false;
    }
    const lastMs = extractTimestampMs(nudge.lastTriggeredAt);
    if (lastMs && localDateKey(new Date(lastMs)) === todayStr) {
      return false;
    }
    return true;
  }

  if (mode === REPEAT_MODE.MULTIPLE_PER_DAY) {
    if (nudge.requireExitBeforeRetrigger !== false && insideZone === true) {
      return false;
    }
    const cooldownMins =
      typeof nudge.cooldownMinutes === 'number' && nudge.cooldownMinutes >= 5
        ? Math.min(720, nudge.cooldownMinutes)
        : 30;
    return !isCooldownActive(nudge, cooldownMins * 60 * 1000, nowMs);
  }

  return !isCooldownActive(nudge, DEFAULT_COOLDOWN_MS, nowMs);
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
 * Checks whether the device has clearly exited the geofence (including hysteresis buffer).
 */
export function hasExitedRadiusWithHysteresis(nudge, coords) {
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
  const accuracyBuffer = typeof coords.accuracy === 'number' && coords.accuracy > 0 ? coords.accuracy : 0;
  const hysteresis = Math.max(accuracyBuffer, EXIT_HYSTERESIS_MIN_METERS);
  return distance > nudge.radiusKm * 1000 + hysteresis;
}
