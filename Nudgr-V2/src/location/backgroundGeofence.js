import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { getAuth, getFirestore, getServerTimestamp } from '../firebase';
import {
  NUDGE_STATUS,
  updateNudge,
  isNudgeActive,
} from '../db/nudges';
import {
  calculateDistanceMeters,
  scheduleAllows,
  isWithinRadius,
  isCooldownActive,
} from './geoUtils';
import { createTriggerEvent } from '../db/triggers';

import AsyncStorage from '@react-native-async-storage/async-storage';

export const GEOFENCE_TASK = 'NUDGR_GEOFENCE_ENTER';

/**
 * Evaluates the SENDER'S active Nudgrs against current GPS coords.
 * This runs inside the background geofence task when an enter event fires,
 * or from the foreground position watcher, or initial startup check.
 */
export async function evaluateSenderNudges(coords, triggeredRegionId = null) {
  if (!coords || typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') {
    console.log('[LOCATION_DIAG] evaluateSenderNudges called with invalid coordinates:', coords);
    return;
  }

  let uid = getAuth().currentUser?.uid;
  if (!uid) {
    try {
      uid = await AsyncStorage.getItem('nudgr_active_uid');
    } catch (_) {}
  }
  if (!uid) {
    console.log('[GEOFENCE_DEBUG] evaluateSenderNudges: No authenticated user ID available');
    return;
  }

  console.log(`[LOCATION_DIAG]\nlocation update received\nlatitude = ${coords.latitude}\nlongitude = ${coords.longitude}\naccuracy = ${coords.accuracy ?? 'unknown'}\ntimestamp = ${coords.timestamp || Date.now()}`);

  try {
    const snap = await getFirestore()
      .collection('nudges')
      .where('senderUid', '==', uid)
      .get();

    const activeDocs = snap.docs.filter((doc) => {
      const data = doc.data();
      return data.status === NUDGE_STATUS.ACTIVE || data.status === NUDGE_STATUS.SCHEDULED;
    });

    console.log(`[NUDGR_DIAG] Found ${activeDocs.length} active/scheduled nudges for evaluation out of ${snap.docs.length} total`);

    for (const doc of activeDocs) {
      const nudge = { id: doc.id, ...doc.data() };

      // Check if Nudgr is enabled/active by user
      if (!isNudgeActive(nudge)) {
        console.log(`[NUDGR_DIAG] Nudge ${nudge.id} is disabled/paused, skipping`);
        continue;
      }

      // Scheduled -> active transition once the schedule allows.
      if (nudge.status === NUDGE_STATUS.SCHEDULED && scheduleAllows(nudge)) {
        try {
          await updateNudge(nudge.id, { status: NUDGE_STATUS.ACTIVE });
          nudge.status = NUDGE_STATUS.ACTIVE;
          console.log(`[NUDGR_DIAG] Nudge ${nudge.id} transitioned from SCHEDULED to ACTIVE`);
        } catch (e) {
          console.warn('[NUDGR_DIAG] Error updating scheduled nudge:', e.message);
        }
      }

      if (nudge.status !== NUDGE_STATUS.ACTIVE) continue;

      // 30-minute cooldown check
      if (isCooldownActive(nudge)) {
        console.log(`[TRIGGER_DIAG]\nNudgr ID = ${nudge.id}\ncondition evaluated = cooldown check\nresult = COOLDOWN_ACTIVE\ntrigger function called = NO`);
        continue;
      }

      const distance = calculateDistanceMeters(
        coords.latitude,
        coords.longitude,
        nudge.triggerLatitude,
        nudge.triggerLongitude
      );
      const configuredRadiusMeters = nudge.radiusKm * 1000;
      const isMatchingRegion = triggeredRegionId && (triggeredRegionId === `nudgr-${nudge.id}` || triggeredRegionId === nudge.id);
      const tolerance = isMatchingRegion ? Math.max(coords.accuracy || 0, 150) : Math.max(coords.accuracy || 0, 50);
      const inside = distance <= (configuredRadiusMeters + tolerance);

      console.log(`[REAL_LOCATION]\nNudgr=${nudge.id}\ndistance=${Math.round(distance)}m\nradius=${configuredRadiusMeters}m\nstate=${inside ? 'INSIDE' : 'OUTSIDE'}`);

      console.log(`[RADIUS_DIAG]\nNudgr ID = ${nudge.id}\nconfigured center = lat ${nudge.triggerLatitude}, lon ${nudge.triggerLongitude}\ncurrent location = lat ${coords.latitude}, lon ${coords.longitude}\nconfigured radius = ${nudge.radiusKm} km (${configuredRadiusMeters} m)\ncalculated distance = ${Math.round(distance)} m\ninside/outside = ${inside ? 'INSIDE' : 'OUTSIDE'}`);

      console.log(`[TRIGGER_DIAG]\nNudgr ID = ${nudge.id}\ncondition evaluated = distance (${Math.round(distance)}m) <= radius (${configuredRadiusMeters}m + tol ${Math.round(tolerance)}m)\nresult = ${inside ? 'TRUE' : 'FALSE'}\ntrigger function called = ${inside ? 'YES' : 'NO'}`);

      if (inside) {
        console.log(`[NUDGR_TRIGGER]\nNudgr ID=${nudge.id}\nsender=${nudge.senderUid}\nrecipient=${nudge.recipientUid}\ntrigger type=LOCATION\nprevious state=${nudge.status}\nnew state=triggered\ntrigger timestamp=${new Date().toISOString()}`);
        try {
          const result = await createTriggerEvent(nudge.id, {
            senderUid: uid,
            recipientUid: nudge.recipientUid,
            triggerLatitude: coords.latitude,
            triggerLongitude: coords.longitude,
            triggeredAt: getServerTimestamp(),
          });
          console.log(`[TRIGGER_DIAG] Trigger event created successfully for nudge ${nudge.id}:`, JSON.stringify(result));
        } catch (err) {
          console.error(`[TRIGGER_DIAG] Error creating trigger event for nudge ${nudge.id}:`, err.message);
        }
      }
    }
  } catch (e) {
    console.error('[GEOFENCE_DEBUG] Error in evaluateSenderNudges:', e.code ?? e.message);
  }
}

// Define the background geofence task at module scope (required by expo-task-manager)
TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[LOCATION_DIAG] Background geofence task error:', error.message);
    return;
  }
  console.log('[LOCATION_DIAG] Background geofence task triggered! Event type:', data?.eventType);

  // Expo Location sends data: { eventType, region: { identifier, latitude, longitude, radius } }
  // Support both data.region (singular, standard Expo) and data.regions (array fallback)
  const region = data?.region;
  const regions = data?.regions || (region ? [region] : []);

  const isEnter = data?.eventType === Location.GeofencingEventType.Enter;
  const enterRegions = isEnter ? regions.filter(Boolean) : [];

  if (enterRegions.length === 0) {
    console.log('[LOCATION_DIAG] No enter regions found in event. Raw data:', JSON.stringify(data));
    return;
  }

  const identifiers = enterRegions.map((r) => r.identifier).filter(Boolean);
  console.log('[LOCATION_DIAG] Geofence enter event received for regions:', identifiers.join(', '));

  for (const reg of enterRegions) {
    let coords = null;

    // 1. Try to acquire high-accuracy GPS position
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (loc?.coords) {
        coords = loc.coords;
        console.log(`[LOCATION_DIAG]\nlocation update received (current GPS)\nlatitude = ${coords.latitude}\nlongitude = ${coords.longitude}\naccuracy = ${coords.accuracy}\ntimestamp = ${loc.timestamp || Date.now()}`);
      }
    } catch (e) {
      console.warn('[LOCATION_DIAG] getCurrentPositionAsync timed out or unavailable in background:', e.message);
      // 2. Fallback to cached last known position
      try {
        const lastLoc = await Location.getLastKnownPositionAsync();
        if (lastLoc?.coords) {
          coords = lastLoc.coords;
          console.log(`[LOCATION_DIAG]\nlocation update received (last known GPS)\nlatitude = ${coords.latitude}\nlongitude = ${coords.longitude}\naccuracy = ${coords.accuracy}\ntimestamp = ${lastLoc.timestamp || Date.now()}`);
        }
      } catch (_) {}
    }

    // 3. If GPS is unavailable in background, fallback to the entered region coordinates (hardware-verified)
    if (!coords && typeof reg.latitude === 'number' && typeof reg.longitude === 'number') {
      coords = {
        latitude: reg.latitude,
        longitude: reg.longitude,
        accuracy: reg.radius || 100,
        timestamp: Date.now(),
      };
      console.log(`[LOCATION_DIAG]\nlocation update received (geofence trigger coordinates)\nlatitude = ${coords.latitude}\nlongitude = ${coords.longitude}\naccuracy = ${coords.accuracy}\ntimestamp = ${coords.timestamp}`);
    }

    if (coords) {
      const transition = isEnter ? 'ENTER' : 'EXIT';
      console.log(`[REAL_LOCATION]\ntimestamp=${new Date().toISOString()}\nlatitude=${coords.latitude}\nlongitude=${coords.longitude}\naccuracy=${coords.accuracy}\nevent=OS_GEOFENCE_TRANSITION\nregionId=${reg.identifier}\ntransition=${transition}`);
      await evaluateSenderNudges(coords, reg.identifier);
    } else {
      console.error('[LOCATION_DIAG] Unable to obtain coordinates for geofence evaluation');
    }
  }
});

/**
 * Ensures foreground + background location permissions are granted.
 */
export async function ensureLocationPermissions() {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    console.log('[GEOFENCE_DEBUG] Foreground location permission:', fg.status);
    if (fg.status !== 'granted') {
      const req = await Location.requestForegroundPermissionsAsync();
      console.log('[GEOFENCE_DEBUG] Foreground permission request result:', req.status);
      if (req.status !== 'granted') return false;
    }
    const bg = await Location.getBackgroundPermissionsAsync();
    console.log('[GEOFENCE_DEBUG] Background location permission:', bg.status);
    if (bg.status === 'granted') return true;

    const req = await Location.requestBackgroundPermissionsAsync();
    console.log('[GEOFENCE_DEBUG] Background permission request result:', req.status);
    return req.status === 'granted';
  } catch (e) {
    console.error('[GEOFENCE_DEBUG] ensureLocationPermissions error:', e.message);
    return false;
  }
}

/**
 * Registers OS-level geofences for the given Nudgrs.
 * @param {Array} nudges - Array of Nudgr objects with triggerLatitude, triggerLongitude, radiusKm, id
 */
export async function registerGeofencesForNudges(nudges) {
  if (!nudges || nudges.length === 0) {
    console.log('[GEOFENCE_DEBUG] registerGeofences called with 0 nudges');
    return { success: 0, failed: 0 };
  }

  console.log('[GEOFENCE_DEBUG] Registering geofences for', nudges.length, 'nudges');

  const hasPerm = await ensureLocationPermissions();
  if (!hasPerm) {
    console.warn('[GEOFENCE_DEBUG] Cannot register geofences: Background location permission not granted');
    return { success: 0, failed: nudges.length, reason: 'permission-denied' };
  }

  const regions = nudges
    .filter(n => 
      typeof n.triggerLatitude === 'number' &&
      typeof n.triggerLongitude === 'number' &&
      typeof n.radiusKm === 'number' &&
      n.id
    )
    .map(n => ({
      identifier: `nudgr-${n.id}`,
      latitude: n.triggerLatitude,
      longitude: n.triggerLongitude,
      radius: n.radiusKm * 1000, // meters
      notifyOnEnter: true,
      notifyOnExit: false,
    }));

  if (regions.length === 0) {
    console.warn('[GEOFENCE_DEBUG] No valid regions found to register');
    return { success: 0, failed: nudges.length, reason: 'no-valid-regions' };
  }

  try {
    // Stop any existing geofences first
    await stopGeofences();

    // Start new geofences
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    
    console.log('[GEOFENCE_DEBUG] Successfully registered', regions.length, 'OS geofences:', regions.map(r => r.identifier).join(', '));
    for (const n of nudges) {
      console.log(`[REAL_GEOFENCE]\nNudgr=${n.id}\ngeofence ID=nudgr-${n.id}\ncenter=lat ${n.triggerLatitude}, lon ${n.triggerLongitude}\nradius=${n.radiusKm * 1000}m\ntransitions=ENTER\nregistration=SUCCESS`);
    }

    // Verify registration with Android OS
    const verified = await getRegisteredGeofences();
    console.log(`[REAL_GEOFENCE]\nverifiedWithAndroidOS=${verified.isStarted ? 'YES' : 'NO'}\nactiveTaskRegistered=${verified.isRegistered ? 'YES' : 'NO'}\nregisteredRegionsCount=${verified.regions.length}`);

    return { success: regions.length, failed: 0 };
  } catch (e) {
    console.error('[GEOFENCE_DEBUG] Failed to startGeofencingAsync:', e.message);
    for (const n of nudges) {
      console.error(`[REAL_GEOFENCE]\nNudgr=${n.id}\ngeofence ID=nudgr-${n.id}\ncenter=lat ${n.triggerLatitude}, lon ${n.triggerLongitude}\nradius=${n.radiusKm * 1000}m\ntransitions=ENTER\nregistration=FAILED\nregistration error=${e.message}`);
    }
    return { success: 0, failed: regions.length, reason: e.message };
  }
}

/**
 * Stops all active geofences.
 */
export async function stopGeofences() {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
    if (isRegistered) {
      const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
      if (running) {
        await Location.stopGeofencingAsync(GEOFENCE_TASK);
      }
    }
  } catch (e) {
    if (__DEV__) console.warn('[stopGeofences]', e.message);
  }
}

/**
 * Checks if geofences are currently active.
 */
export async function areGeofencesActive() {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
    if (!isRegistered) return false;
    return await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  } catch (e) {
    return false;
  }
}

/**
 * Gets the currently registered geofence configuration from Android OS (for verification).
 */
export async function getRegisteredGeofences() {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
    let isStarted = false;
    try {
      isStarted = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
    } catch (_) {}

    let regions = [];
    try {
      const tasks = await TaskManager.getRegisteredTasksAsync();
      const geofenceTask = tasks.find((t) => t.taskName === GEOFENCE_TASK);
      regions = geofenceTask?.options?.regions || [];
    } catch (_) {}

    return {
      isRegistered,
      isStarted,
      regions,
    };
  } catch (e) {
    return { isRegistered: false, isStarted: false, regions: [], error: e.message };
  }
}