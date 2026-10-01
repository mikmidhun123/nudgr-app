import AsyncStorage from '@react-native-async-storage/async-storage';

const RUNTIME_STATUS_KEY = '@nudgr_runtime_status';
const MAX_ENTRIES = 40;

/**
 * Small, durable trace for events that may happen while React is not mounted.
 * Console logs are still emitted, but this makes the last background stages
 * visible after the app is opened again.
 */
export async function recordRuntimeStatus(stage, message, details = {}) {
  const entry = {
    stage,
    message,
    details,
    at: new Date().toISOString(),
  };

  console.log(`[NUDGR_STATUS] ${stage}: ${message}`, details);
  try {
    const raw = await AsyncStorage.getItem(RUNTIME_STATUS_KEY);
    const previous = raw ? JSON.parse(raw) : [];
    const entries = Array.isArray(previous) ? previous : [];
    entries.unshift(entry);
    await AsyncStorage.setItem(RUNTIME_STATUS_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch (error) {
    console.warn('[NUDGR_STATUS] Could not persist diagnostic:', error?.message || error);
  }
  return entry;
}

export async function getRuntimeStatuses() {
  try {
    const raw = await AsyncStorage.getItem(RUNTIME_STATUS_KEY);
    const entries = raw ? JSON.parse(raw) : [];
    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    return [];
  }
}

export async function clearRuntimeStatuses() {
  await AsyncStorage.removeItem(RUNTIME_STATUS_KEY);
}
