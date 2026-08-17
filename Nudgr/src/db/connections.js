import { getAuth, getFirestore, getServerTimestamp } from '../firebase';
import { normalizeConnectionCode } from './codes';

// Deterministic connection document id for a pair of UIDs (sorted).
export function connectionDocId(uidA, uidB) {
  return uidA < uidB ? `${uidA}_${uidB}` : `${uidB}_${uidA}`;
}

/**
 * Validates an entered code and persists the A <-> B bilateral connection.
 * Idempotent: reconnecting the same pair is a safe no-op.
 */
export async function connectByCode(rawCode) {
  const code = normalizeConnectionCode(rawCode);
  if (!code) {
    throw new Error('Enter a connection code.');
  }

  const myUid = getAuth().currentUser?.uid;
  if (!myUid) {
    throw new Error('You must be signed in.');
  }

  const codeSnap = await getFirestore().collection('connectionCodes').doc(code).get();
  if (!codeSnap.exists) {
    throw new Error('That connection code does not exist.');
  }

  const otherUid = codeSnap.data()?.uid;
  if (!otherUid) {
    throw new Error('Invalid connection code.');
  }

  if (otherUid === myUid) {
    throw new Error('That is your own connection code. Enter another person\'s code to connect.');
  }

  const connectionId = connectionDocId(myUid, otherUid);
  const pair = [myUid, otherUid].sort();
  const connectionRef = getFirestore().collection('connections').doc(connectionId);
  const myMirrorRef = getFirestore().collection('users').doc(myUid).collection('connections').doc(otherUid);
  const otherMirrorRef = getFirestore().collection('users').doc(otherUid).collection('connections').doc(myUid);

  // 1. Create canonical connection record
  await connectionRef.set({
    connectionId,
    users: pair,
    status: 'connected',
    createdAt: getServerTimestamp(),
    updatedAt: getServerTimestamp(),
  }, { merge: true });

  // 2. Create my connection mirror
  await myMirrorRef.set({
    connectionId,
    status: 'connected',
    createdAt: getServerTimestamp(),
  }, { merge: true });

  // 3. Create peer's connection mirror
  await otherMirrorRef.set({
    connectionId,
    status: 'connected',
    createdAt: getServerTimestamp(),
  }, { merge: true });

  return { otherUid, connectionId };
}

/**
 * Live subscription to the current user's connections.
 * Resolves each mirror doc to the peer's profile document.
 */
export function subscribeConnections(uid, onChange, onError) {
  if (!uid) return () => {};
  const ref = getFirestore().collection('users').doc(uid).collection('connections');
  return ref.onSnapshot(
    async (snapshot) => {
      const items = await Promise.all(
        snapshot.docs.map(async (doc) => {
          const otherUid = doc.id;
          const data = doc.data();
          let profile = null;
          try {
            const p = await getFirestore().collection('users').doc(otherUid).get();
            if (p.exists) {
              profile = p.data();
            }
          } catch (e) {
            // Peer profile may be temporarily unreadable; keep the connection item
          }
          return { otherUid, status: data.status, connectionId: data.connectionId, profile };
        })
      );
      onChange(items);
    },
    (e) => {
      if (onError) {
        onError(e);
      }
    }
  );
}