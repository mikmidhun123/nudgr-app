import { getAuth, getFirestore, getMessaging, getServerTimestamp, getFieldDelete } from '../firebase';

function userRef(uid) {
  return getFirestore().collection('users').doc(uid);
}

// Associates the current device's FCM token with the user's own account
// under users/{uid}.fcmTokens.<token> = true.
export async function syncFcmToken(firebaseUser) {
  const uid = firebaseUser?.uid ?? getAuth().currentUser?.uid;
  if (!uid) {
    return;
  }
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
    await userRef(uid).set({
      uid,
      [`fcmTokens.${token}`]: true,
      updatedAt: getServerTimestamp(),
    }, { merge: true });
  } catch (e) {
    if (__DEV__) console.warn('[syncFcmToken]', e.message);
  }
}

// Best-effort removal of the current token on sign-out.
export async function removeFcmToken(firebaseUser) {
  const uid = firebaseUser?.uid ?? getAuth().currentUser?.uid;
  if (!uid) {
    return;
  }
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
  getMessaging().onTokenRefresh((token) => {
    const uid = getAuth().currentUser?.uid;
    if (!uid) {
      return;
    }
    userRef(uid)
      .set({
        uid,
        [`fcmTokens.${token}`]: true,
        updatedAt: getServerTimestamp(),
      }, { merge: true })
      .catch((e) => {
        if (__DEV__) {
          console.warn('[fcm-refresh]', e.code ?? e.message);
        }
      });
  });
}