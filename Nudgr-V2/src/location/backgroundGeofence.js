import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { getAuth, getFirestore, getServerTimestamp } from '../firebase';
import {
  NUDGE_STATUS,
  updateNudge,
  isNudgeActive,
} from '../db/nudges';
import { scheduleAllows, isWithinRadius, isCooldownActive } from './triggerEngine';
import { createTriggerEvent } from '../db/triggers';

export const GEOFENCE_TASK = 'NUDGR_GEOFENCE_ENTER';

/**
 * Evaluates the SENDER'S active Nudgrs against current GPS coords.
 * This runs inside the background geofence task when an enter event fires.
 * The sender is the person who created the Nudgr and whose movement triggers it.
 */
async function evaluateSenderNudges(coords) {
  if (!coords || typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') {
    console.log('[GEOFENCE_DEBUG] evaluateSenderNudges called with invalid coordinates:', coords);
    return;
  }
  const uid = getAuth().currentUser?.uid;
  if (!uid) {
    console.log('[GEOFENCE_DEBUG] evaluateSenderNudges: No authenticated user');
    return;
  }

  console.log('[GEOFENCE_DEBUG] Evaluating active Nudgrs at lat:', coords.latitude, 'lon:', coords.longitude, 'for user:', uid);

  try {
    const snap = await getFirestore()
      .collection('nudges')
      .where('senderUid', '==', uid)
      .where('status', 'in', [NUDGE_STATUS.ACTIVE, NUDGE_STATUS.SCHEDULED])
      .get();

    console.log('[GEOFENCE_DEBUG] Found', snap.docs.length, 'active/scheduled nudges for evaluation');

    for (const doc of snap.docs) {
      const nudge = { id: doc.id, ...doc.data() };

      // Check if Nudgr is enabled/active by user
      if (!isNudgeActive(nudge)) {
        console.log('[GEOFENCE_DEBUG] Nudge is disabled/paused, skipping:', nudge.id);
        continue;
      }

      // Scheduled -> active transition once the schedule allows.
      if (nudge.status === NUDGE_STATUS.SCHEDULED && scheduleAllows(nudge)) {
        try {
          await updateNudge(nudge.id, { status: NUDGE_STATUS.ACTIVE });
          nudge.status = NUDGE_STATUS.ACTIVE;
          console.log('[GEOFENCE_DEBUG] Nudge transitioned from SCHEDULED to ACTIVE:', nudge.id);
        } catch (e) {
          console.warn('[GEOFENCE_DEBUG] Error updating scheduled nudge:', e.message);
        }
      }

      if (nudge.status !== NUDGE_STATUS.ACTIVE) continue;

      // 30-minute cooldown check
      if (isCooldownActive(nudge)) {
        console.log('[GEOFENCE_DEBUG] Cooldown is currently active for nudge:', nudge.id);
        continue;
      }

      // User-configured radius: radiusKm * 1000 meters.
      if (isWithinRadius(nudge, coords)) {
        console.log('[GEOFENCE_DEBUG] Location is WITHIN radius for nudge:', nudge.id, 'Message:', nudge.message);

        // Create idempotent trigger event (server-side validation happens in Cloud Function)
        const result = await createTriggerEvent(nudge.id, {
          recipientUid: nudge.recipientUid,
          triggerLatitude: coords.latitude,
          triggerLongitude: coords.longitude,
          triggeredAt: getServerTimestamp(),
        });
        console.log('[GEOFENCE_DEBUG] Trigger event created:', JSON.stringify(result));
      } else {
        console.log('[GEOFENCE_DEBUG] Nudge', nudge.id, 'is outside configured radius');
      }
    }
  } catch (e) {
    console.error('[GEOFENCE_DEBUG] Error in evaluateSenderNudges:', e.code ?? e.message);
  }
}

// Define the background geofence task at module scope (required by expo-task-manager)
TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[GEOFENCE_DEBUG] Background task error:', error.message);
    return;
  }
  console.log('[GEOFENCE_DEBUG] Background geofence task triggered! Event type:', data?.eventType);

  // Geofence events contain an array of region events
  const events = data?.eventType === Location.GeofencingEventType.Enter
    ? data.regions?.map(r => r.identifier).filter(Boolean)
    : [];
  
  if (events.length === 0) {
    console.log('[GEOFENCE_DEBUG] No enter regions found in event');
    return;
  }

  console.log('[GEOFENCE_DEBUG] Geofence enter event received for regions:', events.join(', '));

  try {
    // Get current location to pass to evaluator
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    if (loc?.coords) {
      console.log('[GEOFENCE_DEBUG] Current GPS acquired:', loc.coords.latitude, loc.coords.longitude);
      await evaluateSenderNudges(loc.coords);
    }
  } catch (e) {
    console.error('[GEOFENCE_DEBUG] Error getting position in geofence task:', e.message);
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
    return { success: regions.length, failed: 0 };
  } catch (e) {
    console.error('[GEOFENCE_DEBUG] Failed to startGeofencingAsync:', e.message);
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
 * Gets the currently registered geofence identifiers (for debugging).
 */
export async function getRegisteredGeofences() {
  try {
    // Expo Location doesn't expose a direct API to list active geofences
    // This would need native module access; returning empty for now
    return [];
  } catch (e) {
    return [];
  }
}