import { getApp, getAuth, getFirestore, getServerTimestamp, isQaBuild } from '../firebase';
import { normalizeConnectionCode } from './codes';

// Deterministic connection document id for a pair of UIDs (sorted).
export function connectionDocId(uidA, uidB) {
  return uidA < uidB ? `${uidA}_${uidB}` : `${uidB}_${uidA}`;
}

/**
 * Direct Firestore connection fallback when the optional Cloud Function endpoint
 * is not deployed on the target Firebase project (e.g. Spark tier / held backend rollout).
 */
async function connectByCodeDirectFirestore(code, myUid) {
  const db = getFirestore();
  const codeSnap = await db.collection('connectionCodes').doc(code).get();
  if (!codeSnap.exists()) {
    throw new Error('That connection code does not exist. Check the code and try again.');
  }

  const otherUid = codeSnap.data()?.uid;
  if (!otherUid) {
    throw new Error('Invalid connection code.');
  }

  if (otherUid === myUid) {
    throw new Error("That is your own connection code. Enter another person's code to connect.");
  }

  const connectionId = connectionDocId(myUid, otherUid);
  const pair = [myUid, otherUid].sort();
  const connectionRef = db.collection('connections').doc(connectionId);
  const myMirrorRef = db.collection('users').doc(myUid).collection('connections').doc(otherUid);
  const otherMirrorRef = db.collection('users').doc(otherUid).collection('connections').doc(myUid);

  await connectionRef.set(
    {
      connectionId,
      users: pair,
      status: 'connected',
      verification: 'invitation-code',
      createdAt: getServerTimestamp(),
      updatedAt: getServerTimestamp(),
    },
    { merge: true }
  );

  await myMirrorRef.set(
    {
      connectionId,
      status: 'connected',
      verification: 'invitation-code',
      createdAt: getServerTimestamp(),
    },
    { merge: true }
  );

  await otherMirrorRef.set(
    {
      connectionId,
      status: 'connected',
      verification: 'invitation-code',
      createdAt: getServerTimestamp(),
    },
    { merge: true }
  );

  return { otherUid, connectionId };
}

/**
 * Validates an entered code and persists the A <-> B bilateral connection.
 * Idempotent: reconnecting the same pair is a safe no-op.
 */
export async function connectByCode(rawCode) {
  const code = normalizeConnectionCode(rawCode);
  if (!code || code.length < 6) {
    throw new Error('Enter a valid 8-character connection code.');
  }

  const myUid = getAuth().currentUser?.uid;
  if (!myUid) {
    throw new Error('You must be signed in.');
  }

  // On non-QA builds against the live Firebase project where the optional Cloud Function
  // is not yet deployed, resolve via Firestore directly first and fall back to the Cloud
  // Function endpoint if rules restrict direct lookup.
  if (!isQaBuild) {
    try {
      return await connectByCodeDirectFirestore(code, myUid);
    } catch (directErr) {
      const msg = String(directErr?.message || '');
      const errCode = String(directErr?.code || '');
      const isPermissionDenied =
        errCode.includes('permission-denied') ||
        /permission-denied|insufficient permissions/i.test(msg);
      if (!isPermissionDenied) {
        throw directErr;
      }
    }
  }

  const projectId = getApp()?.options?.projectId || 'nudgr-e6049';
  const token = await getAuth().currentUser.getIdToken();
  const endpoint = isQaBuild
    ? 'http://127.0.0.1:5008/connectByCode'
    : `https://us-central1-${projectId}.cloudfunctions.net/connectByCode`;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 12000) : null;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ code }),
      ...(controller ? { signal: controller.signal } : {}),
    });

    const rawText = await response.text();
    let result = null;
    try {
      result = JSON.parse(rawText);
    } catch (parseErr) {
      // Endpoint returned HTML (e.g. 404 Not Found because Cloud Function is not deployed)
      if (!isQaBuild) {
        return await connectByCodeDirectFirestore(code, myUid);
      }
      throw new Error('Connection service returned an invalid response.', { cause: parseErr });
    }

    if (!response.ok) {
      if (!isQaBuild && (response.status === 404 || response.status === 502 || response.status === 503)) {
        return await connectByCodeDirectFirestore(code, myUid);
      }
      throw new Error(result?.message || 'Could not connect. Please check the code and try again.');
    }
    return result;
  } catch (err) {
    if (
      !isQaBuild &&
      (err.name === 'AbortError' ||
        /unexpected character|json|network|failed to fetch|404|abort/i.test(err.message || ''))
    ) {
      return await connectByCodeDirectFirestore(code, myUid);
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Live subscription to the current user's connections.
 * Resolves each mirror doc to the peer's profile document (checking `profiles/{uid}`
 * first and falling back to `users/{uid}` when running against legacy rulesets).
 */
export function subscribeConnections(uid, onChange, onError) {
  if (!uid) return () => {};
  const db = getFirestore();
  const ref = db.collection('users').doc(uid).collection('connections');
  let active = true;
  let generation = 0;
  const unsubscribe = ref.onSnapshot(
    async (snapshot) => {
      const current = ++generation;
      const items = await Promise.all(
        snapshot.docs.map(async (doc) => {
          const otherUid = doc.id;
          const data = doc.data() || {};
          let profile = null;
          try {
            const p = await db.collection('profiles').doc(otherUid).get();
            if (p.exists()) {
              profile = p.data();
            }
          } catch (_) {}

          if (!profile) {
            try {
              const u = await db.collection('users').doc(otherUid).get();
              if (u.exists()) {
                const uData = u.data() || {};
                profile = {
                  uid: otherUid,
                  displayName: uData.displayName || (uData.email ? uData.email.split('@')[0] : null),
                  email: uData.email || null,
                };
              }
            } catch (_) {}
          }

          const verified = data.verification === 'invitation-code' || data.status === 'connected';
          return {
            otherUid,
            status: verified ? data.status || 'connected' : 'Verify connection code',
            verified,
            connectionId: data.connectionId,
            profile,
          };
        })
      );
      if (active && current === generation) onChange(items);
    },
    (e) => {
      if (onError) {
        onError(e);
      }
    }
  );
  return () => {
    active = false;
    unsubscribe();
  };
}
