import { getAuth, getFirestore, getMessaging, getServerTimestamp, getFieldDelete } from '../firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, NativeModules } from 'react-native';

const INSTALLATION_KEY = '@nudgr_installation_id';
let installationPromise;
const signedOutUsers = new Set();
const tokenGenerations = new Map();

export function getInstallationId() {
  if (NativeModules?.NudgrNativeModule?.installationId) return Promise.resolve(NativeModules.NudgrNativeModule.installationId);
  if (!installationPromise) {
    installationPromise = (async () => {
      const stored = await AsyncStorage.getItem(INSTALLATION_KEY);
      if (stored) return stored;
      const id = `device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
      await AsyncStorage.setItem(INSTALLATION_KEY, id);
      return id;
    })().catch(error => { installationPromise = null; throw error; });
  }
  return installationPromise;
}

function userRef(uid) {
  return getFirestore().collection('users').doc(uid);
}

async function storeToken(uid, token) {
  const generation = tokenGenerations.get(uid);
  if (getAuth().currentUser?.uid !== uid || signedOutUsers.has(uid) || !token) return;
  const deviceId = await getInstallationId();
  if (getAuth().currentUser?.uid !== uid || signedOutUsers.has(uid)) return;
  await userRef(uid).collection('devices').doc(deviceId).set({
    uid, deviceId, fcmToken: token, platform: Platform.OS, enabled: true,
    updatedAt: getServerTimestamp(),
  }, { merge: true });
  if (getAuth().currentUser?.uid !== uid || signedOutUsers.has(uid) || tokenGenerations.get(uid) !== generation) return;
  // Compatibility mirror for the existing backend during staged rollout.
  // Hardened rules make users/{uid} owner-only, including all legacy tokens.
  await userRef(uid).set({ uid, fcmTokens: { [token]: true }, updatedAt: getServerTimestamp() }, { merge: true });
}

// Private installation records are authoritative for the hardened backend.
export async function syncFcmToken(firebaseUser) {
  if (NativeModules?.NudgrNativeModule?.ciAuth === true) return null;
  const uid = firebaseUser?.uid ?? getAuth().currentUser?.uid;
  if (!uid) {
    return;
  }
  signedOutUsers.delete(uid);
  tokenGenerations.set(uid, (tokenGenerations.get(uid) || 0) + 1);
  let token;
  try {
    token = await getMessaging().getToken();
  } catch (e) {
    return;
  }
  if (!token) {
    return;
  }
  try {
    await storeToken(uid, token);
    console.log('[FCM_TOKEN] Private device registration synchronized');
  } catch (e) {
    console.warn(`[FCM_TOKEN] syncFcmToken FAILED uid=${uid} error=${e.message}`);
  }
}

// Best-effort removal of the current token on sign-out.
export async function removeFcmToken(firebaseUser) {
  const uid = firebaseUser?.uid ?? getAuth().currentUser?.uid;
  if (!uid) {
    return;
  }
  signedOutUsers.add(uid);
  const generation = (tokenGenerations.get(uid) || 0) + 1;
  tokenGenerations.set(uid, generation);
  let token;
  try {
    token = await getMessaging().getToken();
  } catch (e) {
    return;
  }
  if (!token) {
    return;
  }
  try {
    const deviceId = await getInstallationId();
    if (getAuth().currentUser?.uid !== uid || tokenGenerations.get(uid) !== generation) return;
    await userRef(uid).collection('devices').doc(deviceId).set({
      uid, deviceId, fcmToken: token, platform: Platform.OS, enabled: false,
      updatedAt: getServerTimestamp(),
    }, { merge: true });
    if (getAuth().currentUser?.uid !== uid || tokenGenerations.get(uid) !== generation) return;
    await userRef(uid).update({
      uid,
      [`fcmTokens.${token}`]: getFieldDelete(),
      updatedAt: getServerTimestamp(),
    });
  } catch (e) {
    // Ignore — token removal is best effort.
  }
}

// Keeps the stored token fresh when Firebase rotates it. Register once.
export function attachFcmTokenRefresh() {
  return getMessaging().onTokenRefresh((token) => {
    const uid = getAuth().currentUser?.uid;
    if (!uid) {
      return;
    }
    return storeToken(uid, token)
      .catch((e) => {
        if (__DEV__) {
          console.warn('[fcm-refresh]', e.code ?? e.message);
        }
      });
  });
}
