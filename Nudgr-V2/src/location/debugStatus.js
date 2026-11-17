import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  GEOFENCE_TASK,
  GEOFENCE_NUDGES_STORAGE_KEY,
  getRegisteredGeofences,
  registerGeofencesForNudges,
} from './backgroundGeofence';

export async function getGeofenceDiagnostics() {
  const registered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
  const started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  const tasks = await Location.getRegisteredTasksAsync();
  const geofenceTask = tasks.find((t) => t.taskName === GEOFENCE_TASK);
  const regions = geofenceTask?.options?.regions || [];

  const fgPerm = await Location.getForegroundPermissionsAsync();
  const bgPerm = await Location.getBackgroundPermissionsAsync();

  return {
    taskRegistered: registered,
    geofencesStarted: started,
    activeRegionsCount: regions.length,
    foregroundPermission: fgPerm.status,
    backgroundPermission: bgPerm.status,
    locationServicesEnabled: started,
    statusMessage: registered && started 
      ? 'Geofences active and monitoring'
      : registered && !started 
        ? 'Task registered but geofences not started (may need re-registration)'
        : 'Task not registered - geofences will not fire',
  };
}

export async function verifyAndReRegisterGeofences() {
  console.log('[GEOSVC] Starting geofence verification and re-registration...');

  // Check if task is registered
  const taskRegistered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
  console.log('[GEOSVC] Task registered:', taskRegistered);

  if (!taskRegistered) {
    console.error('[GEOSVC][ERROR] Geofence task not registered - cannot verify');
    return { success: false, reason: 'task-not-registered' };
  }

  // Check if geofences are started
  const geofencesStarted = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  console.log('[GEOSVC] Geofences started:', geofencesStarted);

  if (!geofencesStarted) {
    console.warn('[BG_GEOFENCE_DEBUG] Geofences not started in OS, attempting auto re-registration from cache');
    try {
      const cached = await AsyncStorage.getItem(GEOFENCE_NUDGES_STORAGE_KEY);
      if (cached) {
        const nudges = JSON.parse(cached);
        if (Array.isArray(nudges) && nudges.length > 0) {
          const res = await registerGeofencesForNudges(nudges);
          console.log('[BG_GEOFENCE_DEBUG] Re-registration from cache result:', JSON.stringify(res));
          return { success: res.success > 0, reason: res.reason || 're-registered-from-cache' };
        }
      }
    } catch (err) {
      console.warn('[BG_GEOFENCE_DEBUG] Error during cache re-registration:', err.message);
    }
    return { success: false, reason: 'geofences-not-started' };
  }

  // Verify registered regions
  const verified = await getRegisteredGeofences();
  console.log('[GEOSVC] Verified regions:', verified.regions.length);
  console.log('[GEOSVC] isRegistered:', verified.isRegistered);
  console.log('[GEOSVC] isStarted:', verified.isStarted);

  return { success: verified.isStarted && verified.isRegistered, reason: 'ok' };
}
