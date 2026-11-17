import { getFirestore, getServerTimestamp } from '../firebase';
import { generateConnectionCode } from './codes';

export function userDoc(uid) {
  return getFirestore().collection('users').doc(uid);
}

export async function publishUserProfile(uid, data) {
  const displayName = String(data.displayName || '').trim().slice(0, 100) || 'Nudgr user';
  await getFirestore().collection('profiles').doc(uid).set({
    uid, displayName, email: typeof data.email === 'string' ? data.email.trim().slice(0, 254) : null, updatedAt: getServerTimestamp(),
  }, { merge: true });
}

export async function getUserProfile(uid) {
  if (!uid) return null;
  const snap = await userDoc(uid).get();
  return snap.exists() ? snap.data() : null;
}

/**
 * Subscribes to live changes on the user's profile document.
 */
export function subscribeUserProfile(uid, onChange, onError) {
  if (!uid) return () => {};
  return userDoc(uid).onSnapshot(
    (snap) => {
      onChange(snap.exists() ? snap.data() : null);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

/**
 * Ensures users/{uid} exists with a stable, unique connection code.
 * If the profile or connection code does not exist, generates a fresh unique code,
 * writes to connectionCodes/{code} and users/{uid}, and returns the complete profile.
 */
const pendingProfiles = new Map();
export function ensureUserProfile(firebaseUser) {
  if (!firebaseUser?.uid) return Promise.resolve(null);
  const uid = firebaseUser.uid, existing = pendingProfiles.get(uid);
  if (existing) {
    if (firebaseUser.displayName?.trim()) existing.displayName = firebaseUser.displayName.trim();
    return existing.promise;
  }
  const entry = { displayName: firebaseUser.displayName?.trim() || null, promise: null };
  entry.promise = ensureUserProfileNow(firebaseUser).then(async data => {
    if (data && entry.displayName && data.displayName !== entry.displayName) {
      await userDoc(uid).set({ displayName: entry.displayName, updatedAt: getServerTimestamp() }, { merge: true });
      data = { ...data, displayName: entry.displayName };
      await publishUserProfile(uid, data).catch(() => {});
    }
    return data;
  }).finally(() => { if (pendingProfiles.get(uid) === entry) pendingProfiles.delete(uid); });
  pendingProfiles.set(uid, entry);
  return entry.promise;
}

async function ensureUserProfileNow(firebaseUser) {
  if (!firebaseUser || !firebaseUser.uid) return null;
  const uid = firebaseUser.uid;
  const userRef = userDoc(uid);

  // 1. If user document exists with a connection code, return it.
  try {
    const snap = await userRef.get();
    if (snap.exists()) {
      const data = snap.data();
      if (data && data.connectionCode) {
        const displayName = firebaseUser.displayName?.trim();
        if (displayName && data.displayName !== displayName) {
          await userRef.set({ displayName, updatedAt: getServerTimestamp() }, { merge: true });
          data.displayName = displayName;
        }
        // Ensure reverse lookup document exists
        const codeRef = getFirestore().collection('connectionCodes').doc(data.connectionCode);
        const codeSnap = await codeRef.get();
        if (!codeSnap.exists()) {
          await codeRef.set({
            uid,
            createdAt: getServerTimestamp(),
          });
        }
        await publishUserProfile(uid, data).catch(error => {
          if (__DEV__) console.warn('[profile:publish]', error.code);
        });
        return data;
      }
    }
  } catch (err) {
    if (__DEV__) {
      console.warn('[ensureUserProfile:get]', err.message);
    }
    throw err; // A failed lookup must never rotate an existing invitation code.
  }

  // 2. Generate and claim a new connection code
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateConnectionCode();
    const codeRef = getFirestore().collection('connectionCodes').doc(code);

    try {
      // Check collision
      const codeSnap = await codeRef.get();
      if (codeSnap.exists() && codeSnap.data()?.uid !== uid) {
        // Code collision; generate another
        continue;
      }

      // Claim code
      await codeRef.set({
        uid,
        createdAt: getServerTimestamp(),
      });

      // Write user profile document
      const profileData = {
        uid,
        email: firebaseUser.email ?? null,
        ...(firebaseUser.displayName?.trim() ? { displayName: firebaseUser.displayName.trim() } : {}),
        connectionCode: code,
        connectionCodeVersion: 2,
        updatedAt: getServerTimestamp(),
      };

      await userRef.set(profileData, { merge: true });
      await publishUserProfile(uid, profileData).catch(error => {
        if (__DEV__) console.warn('[profile:publish]', error.code);
      });

      const finalSnap = await userRef.get();
      return finalSnap.exists() ? finalSnap.data() : profileData;
    } catch (e) {
      if (__DEV__) {
        console.warn(`[ensureUserProfile:attempt-${attempt}]`, e.message);
      }
      if (attempt === 4) {
        throw e;
      }
    }
  }

  return null;
}
