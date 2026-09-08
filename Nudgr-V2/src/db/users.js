import { getFirestore, getServerTimestamp } from '../firebase';
import { generateConnectionCode } from './codes';

export function userDoc(uid) {
  return getFirestore().collection('users').doc(uid);
}

export async function getUserProfile(uid) {
  if (!uid) return null;
  const snap = await userDoc(uid).get();
  return snap.exists ? snap.data() : null;
}

/**
 * Subscribes to live changes on the user's profile document.
 */
export function subscribeUserProfile(uid, onChange, onError) {
  if (!uid) return () => {};
  return userDoc(uid).onSnapshot(
    (snap) => {
      onChange(snap.exists ? snap.data() : null);
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
export async function ensureUserProfile(firebaseUser) {
  if (!firebaseUser || !firebaseUser.uid) return null;
  const uid = firebaseUser.uid;
  const userRef = userDoc(uid);

  // 1. If user document exists with a connection code, return it.
  try {
    const snap = await userRef.get();
    if (snap.exists) {
      const data = snap.data();
      if (data && data.connectionCode) {
        // Ensure reverse lookup document exists
        const codeRef = getFirestore().collection('connectionCodes').doc(data.connectionCode);
        const codeSnap = await codeRef.get();
        if (!codeSnap.exists) {
          await codeRef.set({
            uid,
            createdAt: getServerTimestamp(),
          });
        }
        return data;
      }
    }
  } catch (err) {
    if (__DEV__) {
      console.warn('[ensureUserProfile:get]', err.message);
    }
  }

  // 2. Generate and claim a new connection code
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateConnectionCode();
    const codeRef = getFirestore().collection('connectionCodes').doc(code);

    try {
      // Check collision
      const codeSnap = await codeRef.get();
      if (codeSnap.exists && codeSnap.data()?.uid !== uid) {
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
        displayName: firebaseUser.displayName ?? null,
        connectionCode: code,
        updatedAt: getServerTimestamp(),
      };

      await userRef.set(profileData, { merge: true });

      const finalSnap = await userRef.get();
      return finalSnap.exists ? finalSnap.data() : profileData;
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