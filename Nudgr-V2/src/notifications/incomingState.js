import AsyncStorage from '@react-native-async-storage/async-storage';

const INCOMING_STATE_KEY = '@nudgr_incoming_state';
const RINGING_TIMEOUT_MS = 30000;

export const INCOMING_STATES = {
  IDLE: 'idle',
  RINGING: 'ringing',
  ANSWERED: 'answered',
  DECLINED: 'declined',
  MISSED: 'missed',
};

/**
 * Gets the current incoming nudge state from AsyncStorage.
 * @returns {Promise<{nudgeId: string, state: string, timestamp: number, senderName: string} | null>}
 */
export async function getIncomingState() {
  try {
    const stored = await AsyncStorage.getItem(INCOMING_STATE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    // Check if state is stale (> 30 seconds old for RINGING)
    if (parsed.state === INCOMING_STATES.RINGING) {
      const elapsed = Date.now() - parsed.timestamp;
      if (elapsed > RINGING_TIMEOUT_MS) {
        await clearIncomingState();
        return null;
      }
    }
    return parsed;
  } catch (e) {
    if (__DEV__) console.warn('[incomingState] get error:', e.message);
    return null;
  }
}

/**
 * Sets the incoming nudge state in AsyncStorage.
 * @param {string} nudgeId
 * @param {string} state - One of INCOMING_STATES
 * @param {string} senderName
 */
export async function setIncomingState(nudgeId, state, senderName) {
  try {
    const payload = {
      nudgeId,
      state,
      timestamp: Date.now(),
      senderName,
    };
    await AsyncStorage.setItem(INCOMING_STATE_KEY, JSON.stringify(payload));
    if (__DEV__) console.log('[incomingState] set:', payload);
  } catch (e) {
    if (__DEV__) console.warn('[incomingState] set error:', e.message);
  }
}

/**
 * Clears the incoming nudge state.
 */
export async function clearIncomingState() {
  try {
    await AsyncStorage.removeItem(INCOMING_STATE_KEY);
    if (__DEV__) console.log('[incomingState] cleared');
  } catch (e) {
    if (__DEV__) console.warn('[incomingState] clear error:', e.message);
  }
}

/**
 * Checks if there's an active ringing state that should be restored.
 * @returns {Promise<{nudgeId: string, senderName: string} | null>}
 */
export async function getActiveRingingState() {
  const state = await getIncomingState();
  if (state && state.state === INCOMING_STATES.RINGING) {
    return { nudgeId: state.nudgeId, senderName: state.senderName };
  }
  return null;
}