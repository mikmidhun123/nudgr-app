import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { getAuth, getFirestore } from '../firebase';
import {
  NUDGE_STATUS,
  markTriggered,
  updateNudge,
} from '../db/nudges';
import { scheduleAllows, isWithinRadius } from './triggerEngine';
import { showLocalNudgeNotification } from '../notifications/localNotifications';
import { speakNudge } from '../voice/tts';

export const LOCATION_TASK = 'NUDGR_BACKGROUND_LOCATION';

// Deduplication cache to prevent re-triggering the same Nudgr repeatedly across GPS ticks.
const triggeredCache = new Set();

/**
 * Shared evaluation of the RECIPIENT'S active Nudgrs against current GPS coords.
 * Evaluates safely on device with full error boundaries.
 */
async function evaluateNudges(coords) {
  if (!coords || typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') {
    return;
  }
  const uid = getAuth().currentUser?.uid;
  if (!uid) {
    return;
  }

  try {
    const snap = await getFirestore()
      .collection('nudges')
      .where('recipientUid', '==', uid)
      .where('status', 'in', [NUDGE_STATUS.ACTIVE, NUDGE_STATUS.SCHEDULED])
      .get();

    for (const doc of snap.docs) {
      const nudge = { id: doc.id, ...doc.data() };

      // Scheduled -> active transition once the schedule allows.
      if (nudge.status === NUDGE_STATUS.SCHEDULED && scheduleAllows(nudge)) {
        try {
          await updateNudge(nudge.id, { status: NUDGE_STATUS.ACTIVE });
          nudge.status = NUDGE_STATUS.ACTIVE;
        } catch (e) {
          if (__DEV__) console.warn('[update-scheduled]', e.message);
        }
      }

      if (nudge.status !== NUDGE_STATUS.ACTIVE) continue;

      // Prevent duplicate trigger if already fired in this session
      if (triggeredCache.has(nudge.id)) continue;

      // User-configured radius: radiusKm * 1000 meters. (Never hardcoded 5km).
      if (isWithinRadius(nudge, coords)) {
        triggeredCache.add(nudge.id);

        if (__DEV__) console.log('[recipient-trigger]', nudge.id, nudge.message);

        // 1. Primary Reliable Alert: Local Heads-Up Notification
        try {
          await showLocalNudgeNotification(nudge);
        } catch (e) {
          if (__DEV__) console.warn('[notif-trigger]', e.message);
        }

        // 2. Local Text-to-Speech (Optional, best-effort)
        if (nudge.voiceStyle && nudge.voiceStyle !== 'none') {
          try {
            speakNudge(nudge.message, nudge.voiceStyle);
          } catch (e) {
            if (__DEV__) console.warn('[tts-trigger]', e.message);
          }
        }

        // 3. Update Firestore status to 'triggered'
        try {
          await markTriggered(nudge.id);
        } catch (e) {
          if (__DEV__) console.warn('[mark-triggered]', e.message);
        }
      }
    }
  } catch (e) {
    if (__DEV__) console.warn('[bg-location-eval]', e.code ?? e.message);
  }
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    if (__DEV__) console.warn('[bg-location-task-error]', error.message);
    return;
  }
  const locations = data?.locations;
  if (!locations || locations.length === 0) return;

  try {
    if (locations[0]?.coords) {
      await evaluateNudges(locations[0].coords);
    }
  } catch (e) {
    if (__DEV__) console.warn('[bg-task]', e.message);
  }
});

/**
 * Requests location permissions safely.
 * Returns true only if background location is granted.
 */
export async function ensureBackgroundLocationPermission() {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      const req = await Location.requestForegroundPermissionsAsync();
      if (req.status !== 'granted') return false;
    }
    const bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status === 'granted') return true;

    // Only request background permission if foreground is granted
    const req = await Location.requestBackgroundPermissionsAsync();
    return req.status === 'granted';
  } catch (e) {
    if (__DEV__) console.warn('[ensureBackgroundLocationPermission]', e.message);
    return false;
  }
}

/**
 * Starts persistent background location monitoring if background permission is granted.
 * If background permission is not granted, safely returns false to allow foreground watch fallback.
 */
export async function startBackgroundGeofence() {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK);
    if (isRegistered) {
      const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
      if (running) return true;
    }
  } catch (e) {
    if (__DEV__) console.warn('[bg-hasStarted]', e.message);
  }

  try {
    const bgGranted = await ensureBackgroundLocationPermission();
    if (!bgGranted) {
      // Avoid calling startLocationUpdatesAsync without background permission
      return false;
    }

    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15000,
      distanceInterval: 200,
      pausesLocationUpdatesAutomatically: true,
      foregroundService: {
        notificationTitle: 'Nudgr location active',
        notificationBody: 'Monitoring your location for incoming Nudgrs.',
        notificationColor: '#2e7d32',
      },
    });
    return true;
  } catch (e) {
    if (__DEV__) console.warn('[bg-start]', e.message);
    return false;
  }
}

export async function stopBackgroundGeofence() {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK);
    if (registered) {
      const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
      if (running) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      }
    }
  } catch (e) {
    if (__DEV__) console.warn('[bg-stop]', e.message);
  }
}

/**
 * Foreground-only fallback when background location permission is denied.
 * Uses a safe watchPositionAsync subscription that only fires while the app is visible.
 */
export async function startForegroundWatch() {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      return null;
    }
    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 200,
      },
      async (loc) => {
        if (loc && loc.coords) {
          try {
            await evaluateNudges(loc.coords);
          } catch (err) {
            if (__DEV__) console.warn('[watch-eval]', err.message);
          }
        }
      }
    );
    return () => {
      try {
        sub.remove();
      } catch (e) {}
    };
  } catch (e) {
    if (__DEV__) console.warn('[fg-watch-start]', e.message);
    return null;
  }
}
