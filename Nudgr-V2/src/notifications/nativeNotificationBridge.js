import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { getAuth } from '../firebase';

const { NudgrNativeModule } = NativeModules;
const eventEmitter = NudgrNativeModule ? new NativeEventEmitter(NudgrNativeModule) : null;

// null means an older/non-Android build needs the existing Expo fallback.
export async function showNativeIncomingNotification({ nudgeId, triggerId = '', senderName = 'Someone', message = 'Incoming Nudgr',
  recipientUid = getAuth().currentUser?.uid || '', expiresAt = Date.now() + 300000 }) {
  if (Platform.OS !== 'android' || !NudgrNativeModule?.showIncomingNotification) return null;
  return NudgrNativeModule.showIncomingNotification(nudgeId, triggerId, senderName, message, recipientUid, Number(expiresAt));
}

export const setNativeLockscreenAllowed = allowed => NudgrNativeModule?.setLockscreenAllowed?.(allowed);
export const clearNativeAccountState = () => NudgrNativeModule?.clearAccountState?.();
export const flushNativeReceipts = () => NudgrNativeModule?.flushReceipts?.();

export async function getNativeIncomingState(nudgeId = null) {
  if (Platform.OS !== 'android' || !NudgrNativeModule?.getIncomingState) return null;
  return NudgrNativeModule.getIncomingState(nudgeId);
}

export async function recordNativeIncoming(nudgeId, triggerId = '', senderName = '',
  recipientUid = getAuth().currentUser?.uid || '', expiresAt = Date.now() + 300000) {
  if (Platform.OS !== 'android' || !NudgrNativeModule?.recordIncoming) return false;
  return NudgrNativeModule.recordIncoming(nudgeId, triggerId, senderName, recipientUid, Number(expiresAt));
}

export async function setNativeIncomingState(nudgeId, state, senderName = '') {
  if (Platform.OS !== 'android' || !NudgrNativeModule?.setIncomingState) return;
  await NudgrNativeModule.setIncomingState(nudgeId, state, senderName);
}

/**
 * Checks for any pending native notification action from a cold-start intent.
 * Resolves with { action: 'ANSWER' | 'DECLINE' | 'OPEN', nudgeId, triggerId, startAnswered } or null.
 */
export async function getInitialNativeAction() {
  if (Platform.OS !== 'android' || !NudgrNativeModule?.getInitialAction) {
    return null;
  }
  try {
    const action = await NudgrNativeModule.getInitialAction();
    return action;
  } catch (e) {
    console.warn('[NATIVE_NOTIF_BRIDGE] Error getting initial action:', e?.message || e);
    return null;
  }
}

/**
 * Clears the stored initial action once processed.
 */
export async function clearInitialNativeAction() {
  if (Platform.OS !== 'android' || !NudgrNativeModule?.clearInitialAction) {
    return;
  }
  try {
    await NudgrNativeModule.clearInitialAction();
  } catch (e) {
    console.warn('[NATIVE_NOTIF_BRIDGE] Error clearing initial action:', e?.message || e);
  }
}

/**
 * Checks if a native notification is currently tracked as active.
 */
export async function isNativeNotificationActive(nudgeId) {
  if (Platform.OS !== 'android' || !NudgrNativeModule?.isNotificationActive || !nudgeId) {
    return false;
  }
  try {
    return await NudgrNativeModule.isNotificationActive(nudgeId);
  } catch (e) {
    return false;
  }
}

/**
 * Dismisses a native notification from the Android status bar.
 */
export async function dismissNativeNotification(nudgeId) {
  if (Platform.OS !== 'android' || !NudgrNativeModule?.dismissNotification || !nudgeId) {
    return;
  }
  try {
    await NudgrNativeModule.dismissNotification(nudgeId);
  } catch (e) {
    console.warn('[NATIVE_NOTIF_BRIDGE] Error dismissing native notification:', e?.message || e);
  }
}

/**
 * Listens for native Answer / Decline / Open actions dispatched while the app is alive.
 * @param {Function} callback Receives { action, nudgeId, triggerId, startAnswered }
 * @returns {Function} Unsubscribe function
 */
export function addNativeActionListener(callback) {
  if (!eventEmitter || Platform.OS !== 'android') {
    return () => {};
  }
  const subscription = eventEmitter.addListener('onNudgrNativeAction', (event) => {
    console.log('[NATIVE_NOTIF_BRIDGE] Received onNudgrNativeAction:', JSON.stringify(event));
    if (callback) {
      callback(event);
    }
  });
  return () => {
    subscription.remove();
  };
}
