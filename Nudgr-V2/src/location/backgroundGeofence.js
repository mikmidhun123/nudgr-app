import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebase } from '@react-native-firebase/app';
import firestore from '@react-native-firebase/firestore';
import '@react-native-firebase/auth';

import {
  NUDGE_STATUS,
  updateNudge,
  isNudgeActive,
} from '../db/nudges';
import {
  calculateDistanceMeters,
  scheduleAllows,
  isCooldownActive,
} from './geoUtils';
import { createTriggerEvent } from '../db/triggers';
import { showGeofenceEnterNotification } from '../notifications/localNotifications';
import { recordRuntimeStatus } from '../diagnostics/runtimeStatus';

function getAuth() {
  return firebase.auth();
}

function getFirestoreInstance() {
  return firebase.firestore();
}

function getServerTimestampFn() {
  return firestore.FieldValue.serverTimestamp();
}

export const GEOFENCE_TASK = 'NUDGR_GEOFENCE_ENTER';
export const GEOFENCE_NUDGES_STORAGE_KEY = '@nudgr_registered_geofence_nudges';

/**
 * Ensures Firebase is initialized in background context.
 */
async function ensureFirebaseInitialized() {
  if (!firebase.apps.length) {
    try {
      firebase.initializeApp();
      console.log('[GEOSVC] Firebase initialized in background context');
    } catch (e) {
      console.error('[GEOSVC][ERROR] Firebase init failed:', e.message);
      throw e;
    }
  }
}

/**
 * Resolves the sender UID in background context.
 * Tries AsyncStorage first (persisted on sign-in), then falls back to Auth.
 */
async function resolveSenderUid() {
  try {
    const storedUid = await AsyncStorage.getItem('nudgr_active_uid');
    if (storedUid) {
      return storedUid;
    }
  } catch (e) {
    console.warn('[GEOSVC] AsyncStorage read failed:', e.message);
  }

  try {
    await ensureFirebaseInitialized();
    const auth = getAuth();
    const user = auth.currentUser;
    if (user?.uid) {
      return user.uid;
    }
  } catch (e) {
    console.warn('[GEOSVC] Auth resolution failed:', e.message);
  }

  return null;
}

/**
 * Evaluates the current device's SENT Nudgrs against current GPS coords.
 * This runs inside the background geofence task when an enter event fires,
 * or from the foreground position watcher, or initial startup check.
 */
export async function evaluateSenderNudges(coords, triggeredRegionId = null) {
  if (!coords || typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') {
    console.log('[BG_GEOFENCE_DEBUG][ERROR] evaluateSenderNudges called with invalid coordinates:', coords);
    return;
  }

  const uid = await resolveSenderUid();
  if (!uid) {
    console.warn(`[NUDGR_TRIGGER] Skipping geofence evaluation: sender UID unavailable; region=${triggeredRegionId || 'none'}`);
    return;
  }

  console.log(
    `[NUDGR_GEOFENCE_EVENT] task=${GEOFENCE_TASK} event=EVALUATE senderUid=${uid} ` +
    `latitude=${coords.latitude} longitude=${coords.longitude} ` +
    `accuracy=${coords.accuracy ?? 'unknown'} region=${triggeredRegionId || 'none'}`
  );
  await recordRuntimeStatus('GEOFENCE_EVALUATE', 'Evaluating sender-owned Nudgrs', {
    regionId: triggeredRegionId,
    senderUid: uid,
  });

  let allNudges = [];

  // 1. Try reading locally cached registered nudges from AsyncStorage first (offline-first, 0 network latency, 0 auth dependency)
  try {
    const cached = await AsyncStorage.getItem(GEOFENCE_NUDGES_STORAGE_KEY);
    if (cached) {
      allNudges = JSON.parse(cached);
      console.log(`[BG_GEOFENCE_DEBUG] Read ${allNudges.length} registered nudges from local AsyncStorage cache`);
    }
  } catch (cacheErr) {
    console.warn('[BG_GEOFENCE_DEBUG] AsyncStorage read failed:', cacheErr.message);
  }

  // 2. If online, supplement the cache with fresh SENT Nudgr data.
  try {
    const db = getFirestoreInstance();
    const sentSnap = await db.collection('nudges').where('senderUid', '==', uid).get();
    const docsMap = new Map();
    allNudges.forEach((n) => {
      if (n?.id && n.senderUid === uid) docsMap.set(n.id, n);
    });
    sentSnap.docs.forEach((doc) => docsMap.set(doc.id, { id: doc.id, ...doc.data() }));
    allNudges = Array.from(docsMap.values());
    console.log(`[BG_GEOFENCE_DEBUG] Firestore sent-nudge query merged, candidates=${allNudges.length}`);
  } catch (fsErr) {
    console.log(`[BG_GEOFENCE_DEBUG] Firestore sent-nudge query failed (${fsErr.code || fsErr.message}); cached candidates=${allNudges.length}`);
  }

  const activeNudges = allNudges.filter((nudge) => {
    return nudge.senderUid === uid &&
      (nudge.status === NUDGE_STATUS.ACTIVE || nudge.status === NUDGE_STATUS.SCHEDULED);
  });

  console.log(`[BG_GEOFENCE_DEBUG] Found ${activeNudges.length} active/scheduled nudges for evaluation out of ${allNudges.length} total`);

  for (const nudge of activeNudges) {
    if (!isNudgeActive(nudge)) {
      console.log(`[BG_GEOFENCE_DEBUG] Nudge ${nudge.id} is disabled/paused, skipping`);
      continue;
    }

    if (nudge.status === NUDGE_STATUS.SCHEDULED && scheduleAllows(nudge)) {
      try {
        await updateNudge(nudge.id, { status: NUDGE_STATUS.ACTIVE });
        nudge.status = NUDGE_STATUS.ACTIVE;
        console.log(`[BG_GEOFENCE_DEBUG] Nudge ${nudge.id} transitioned from SCHEDULED to ACTIVE`);
      } catch (e) {
        console.warn('[BG_GEOFENCE_DEBUG] Error updating scheduled nudge:', e.message);
      }
    }

    if (nudge.status !== NUDGE_STATUS.ACTIVE) continue;

    if (isCooldownActive(nudge)) {
      console.log(`[BG_GEOFENCE_DEBUG] Nudgr ${nudge.id} cooldown active, skipping trigger`);
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
    console.log(
      `[NUDGR_TRIGGER]\n` +
      `nudge ID=${nudge.id}\n` +
      `sender UID=${nudge.senderUid}\n` +
      `recipient UID=${nudge.recipientUid}\n` +
      `current user UID=${uid || 'unresolved'}\n` +
      `latitude=${coords.latitude}\n` +
      `longitude=${coords.longitude}\n` +
      `radius=${configuredRadiusMeters}m (${nudge.radiusKm}km)\n` +
      `geofence identifier=nudgr-${nudge.id}\n` +
      `task name=${GEOFENCE_TASK}\n` +
      `distance=${Math.round(distance)}m\n` +
      `tolerance=${tolerance}m\n` +
      `result=${inside ? 'INSIDE' : 'OUTSIDE'}`
    );

    if (inside) {
      console.log(`[NUDGR_TRIGGER] ENTER matched sender nudgeId=${nudge.id}; creating trigger event`);
      await recordRuntimeStatus('TRIGGER_START', 'ENTER matched sender Nudgr', {
        nudgeId: nudge.id,
        recipientUid: nudge.recipientUid,
      });
      try {
        const result = await createTriggerEvent(nudge.id, {
          senderUid: uid,
          recipientUid: nudge.recipientUid,
          triggerLatitude: coords.latitude,
          triggerLongitude: coords.longitude,
          triggeredAt: getServerTimestampFn(),
        });
        console.log(`[NUDGR_TRIGGER] nudgeId=${nudge.id} result=${result.created ? 'CREATED' : 'SKIPPED'} cooldown=${!!result.cooldown}`);
        await recordRuntimeStatus('TRIGGER_WRITE', result.created ? 'Trigger event created' : 'Trigger event skipped', {
          nudgeId: nudge.id,
          cooldown: !!result.cooldown,
          triggerEventId: result.id,
        });
      } catch (err) {
        console.error(`[NUDGR_TRIGGER] nudgeId=${nudge.id} result=FAILED error=${err.message}`);
        await recordRuntimeStatus('TRIGGER_WRITE_FAILED', err.message, { nudgeId: nudge.id });
      }
    }
  }
}

// Define the background geofence task at module scope (required by expo-task-manager)
TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.error(`[BG_TASK_EXECUTE][ERROR] Task ${GEOFENCE_TASK} execution error:`, error.message);
    return;
  }

  console.log(
    `[BG_TASK_EXECUTE]\n` +
    `task name=${GEOFENCE_TASK}\n` +
    `eventType=${data?.eventType}\n` +
    `rawEvent=${JSON.stringify(data)}`
  );

  const region = data?.region;
  const regions = data?.regions || (region ? [region] : []);
  const isEnter = data?.eventType === Location.GeofencingEventType.Enter;
  const enterRegions = isEnter ? regions.filter(Boolean) : [];

  if (enterRegions.length === 0) {
    console.log(`[BG_TASK_EXECUTE] No enter regions found in event`);
    return;
  }

  const identifiers = enterRegions.map((r) => r.identifier).filter(Boolean);
  console.log(`[BG_TASK_EXECUTE] Geofence ENTER event received for regions: ${identifiers.join(', ')}`);
  await recordRuntimeStatus('GEOFENCE_ENTER', 'Android OS delivered ENTER event', { regionIds: identifiers });

  // Initialize Firebase early in background task
  try {
    await ensureFirebaseInitialized();
  } catch (e) {
    console.error('[BG_TASK_EXECUTE][ERROR] Firebase initialization failed in background task');
  }

  for (const reg of enterRegions) {
    console.log(
      `[NUDGR_GEOFENCE_EVENT]\n` +
      `eventType=ENTER\n` +
      `region identifier=${reg.identifier}\n` +
      `latitude=${reg.latitude}\n` +
      `longitude=${reg.longitude}\n` +
      `radius=${reg.radius}m\n` +
      `task name=${GEOFENCE_TASK}`
    );

    // This must happen before any Firebase or GPS work. It is the isolated
    // proof that Android woke the app for the ENTER transition.
    const diagnosticNotificationId = await showGeofenceEnterNotification({
      regionId: reg.identifier,
      enteredAt: new Date(),
    });
    await recordRuntimeStatus(
      'GEOFENCE_SELF_NOTIFICATION',
      diagnosticNotificationId ? 'Entered-geofence self notification posted' : 'Entered-geofence self notification failed',
      { regionId: reg.identifier, notificationId: diagnosticNotificationId }
    );

    let coords = null;

    // 1. Try to acquire high-accuracy GPS position
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (loc?.coords) {
        coords = loc.coords;
        console.log(`[BG_GEOFENCE_EVENT] Got current GPS: lat=${coords.latitude}, lon=${coords.longitude}, accuracy=${coords.accuracy}`);
      }
    } catch (e) {
      console.warn('[BG_GEOFENCE_EVENT] getCurrentPositionAsync failed in background:', e.message);
      // 2. Fallback to cached last known position
      try {
        const lastLoc = await Location.getLastKnownPositionAsync();
        if (lastLoc?.coords) {
          coords = lastLoc.coords;
          console.log(`[BG_GEOFENCE_EVENT] Got last known GPS: lat=${coords.latitude}, lon=${coords.longitude}, accuracy=${coords.accuracy}`);
        }
      } catch (_) {}
    }

    // 3. Fallback to hardware region coordinates if GPS unavailable in background
    if (!coords && typeof reg.latitude === 'number' && typeof reg.longitude === 'number') {
      coords = {
        latitude: reg.latitude,
        longitude: reg.longitude,
        accuracy: reg.radius || 100,
        timestamp: Date.now(),
      };
      console.log(`[BG_GEOFENCE_EVENT] Using geofence trigger coordinates: lat=${coords.latitude}, lon=${coords.longitude}`);
    }

    if (coords) {
      await evaluateSenderNudges(coords, reg.identifier);
    } else {
      console.error('[BG_TASK_EXECUTE][ERROR] Unable to obtain coordinates for geofence evaluation');
    }
  }
});

/**
 * Ensures foreground + background location permissions are granted.
 */
export async function ensureLocationPermissions() {
  try {
    console.log('[GEOSVC] Checking location permissions...');
    const fg = await Location.getForegroundPermissionsAsync();
    console.log('[GEOSVC] Foreground location permission:', fg.status);
    if (fg.status !== 'granted') {
      console.log('[GEOSVC] Requesting foreground location permission...');
      const req = await Location.requestForegroundPermissionsAsync();
      console.log('[GEOSVC] Foreground permission request result:', req.status);
      if (req.status !== 'granted') {
        console.error('[GEOSVC][ERROR] Foreground location permission denied');
        return false;
      }
    }
    const bg = await Location.getBackgroundPermissionsAsync();
    console.log('[GEOSVC] Background location permission:', bg.status);
    if (bg.status === 'granted') {
      console.log('[GEOSVC] All location permissions granted');
      return true;
    }

    console.log('[GEOSVC] Requesting background location permission...');
    const req = await Location.requestBackgroundPermissionsAsync();
    console.log('[GEOSVC] Background permission request result:', req.status);
    if (req.status !== 'granted') {
      console.error('[GEOSVC][ERROR] Background location permission denied');
    }
    return req.status === 'granted';
  } catch (e) {
    console.error('[GEOSVC][ERROR] ensureLocationPermissions error:', e.message);
    return false;
  }
}

/**
 * Registers OS-level geofences for the given Nudgrs.
 * @param {Array} nudges - Array of Nudgr objects with triggerLatitude, triggerLongitude, radiusKm, id
 */
export async function registerGeofencesForNudges(nudges) {
  if (!nudges || nudges.length === 0) {
    console.log('[BG_GEOFENCE_DEBUG] registerGeofences called with 0 nudges');
    return { success: 0, failed: 0 };
  }

  const currentUid = await resolveSenderUid();
  if (!currentUid) {
    console.warn('[BG_GEOFENCE_DEBUG] Refusing registration because sender identity is unavailable');
    return { success: 0, failed: nudges.length, reason: 'sender-uid-unavailable' };
  }
  // Defense in depth: callers must never be able to register recipient Nudgrs
  // on this phone, even if a future subscription is wired incorrectly.
  const senderNudges = nudges.filter((n) => n?.id && n.senderUid === currentUid);
  const rejectedRecipientNudges = nudges.length - senderNudges.length;
  if (rejectedRecipientNudges) {
    console.warn(`[BG_GEOFENCE_DEBUG] Rejected ${rejectedRecipientNudges} non-sender geofence candidates`);
  }
  const isTaskDefined = TaskManager.isTaskDefined(GEOFENCE_TASK);
  let isTaskRegistered = false;
  try {
    isTaskRegistered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
  } catch (_) {}

  console.log(
    `[BG_TASK_REGISTER]\n` +
    `task name=${GEOFENCE_TASK}\n` +
    `isTaskDefined=${isTaskDefined}\n` +
    `isTaskRegistered=${isTaskRegistered}\n` +
    `current user UID=${currentUid || 'unknown'}\n` +
    `candidate nudges count=${nudges.length}\n` +
    `sender-owned candidates=${senderNudges.length}`
  );

  const hasPerm = await ensureLocationPermissions();
  if (!hasPerm) {
    console.warn('[BG_GEOFENCE_DEBUG] Cannot register geofences: Background location permission not granted');
    return { success: 0, failed: senderNudges.length, reason: 'permission-denied' };
  }

  // Persist nudges to AsyncStorage so headless task has instant offline access
  try {
    await AsyncStorage.setItem(GEOFENCE_NUDGES_STORAGE_KEY, JSON.stringify(senderNudges));
    console.log(`[BG_GEOFENCE_DEBUG] Persisted ${senderNudges.length} sender nudges to AsyncStorage (${GEOFENCE_NUDGES_STORAGE_KEY})`);
  } catch (err) {
    console.warn('[BG_GEOFENCE_DEBUG] Failed to persist nudges to AsyncStorage:', err.message);
  }

  const regions = senderNudges
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
    console.warn('[BG_GEOFENCE_DEBUG] No valid regions found to register');
    return { success: 0, failed: senderNudges.length, reason: 'no-valid-regions' };
  }

  try {
    // Stop any existing geofences first
    await stopGeofences();

    // Start new geofences
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    
    const verifiedAfter = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
    console.log(`[BG_TASK_REGISTER] Task ${GEOFENCE_TASK} verified with TaskManager after startGeofencing: ${verifiedAfter}`);

    for (const n of senderNudges) {
      console.log(
        `[NUDGR_GEOFENCE_REGISTER]\n` +
        `nudge ID=${n.id}\n` +
        `sender UID=${n.senderUid}\n` +
        `recipient UID=${n.recipientUid}\n` +
        `current user UID=${currentUid || 'unknown'}\n` +
        `latitude=${n.triggerLatitude}\n` +
        `longitude=${n.triggerLongitude}\n` +
        `radius=${n.radiusKm * 1000}m (${n.radiusKm}km)\n` +
        `geofence identifier=nudgr-${n.id}\n` +
        `task name=${GEOFENCE_TASK}\n` +
        `registration status=SUCCESS`
      );
    }

    // Verify registration with Android OS
    const verified = await getRegisteredGeofences();
    console.log(`[BG_GEOFENCE_DEBUG] Verified with Android OS: started=${verified.isStarted}, registered=${verified.isRegistered}, count=${verified.regions.length}`);
    await recordRuntimeStatus('GEOFENCE_REGISTERED', 'Sender-only regions registered with Android OS', {
      count: regions.length,
      regionIds: regions.map((region) => region.identifier),
    });

    return { success: regions.length, failed: 0 };
  } catch (e) {
    console.error('[BG_GEOFENCE_DEBUG] Failed to startGeofencingAsync:', e.message);
    await recordRuntimeStatus('GEOFENCE_REGISTRATION_FAILED', e.message, { count: regions.length });
    for (const n of senderNudges) {
      console.error(
        `[NUDGR_GEOFENCE_REGISTER]\n` +
        `nudge ID=${n.id}\n` +
        `sender UID=${n.senderUid}\n` +
        `recipient UID=${n.recipientUid}\n` +
        `current user UID=${currentUid || 'unknown'}\n` +
        `latitude=${n.triggerLatitude}\n` +
        `longitude=${n.triggerLongitude}\n` +
        `radius=${n.radiusKm * 1000}m (${n.radiusKm}km)\n` +
        `geofence identifier=nudgr-${n.id}\n` +
        `task name=${GEOFENCE_TASK}\n` +
        `registration status=FAILED\n` +
        `error=${e.message}`
      );
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

/** Removes cached regions when this user no longer owns active sender Nudgrs. */
export async function clearPersistedSenderGeofences() {
  try {
    await AsyncStorage.removeItem(GEOFENCE_NUDGES_STORAGE_KEY);
    await recordRuntimeStatus('GEOFENCE_CACHE_CLEARED', 'No sender geofences remain on this device');
  } catch (error) {
    console.warn('[BG_GEOFENCE_DEBUG] Could not clear sender geofence cache:', error?.message || error);
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
