const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function profile(uid, data = {}) {
  return { uid, displayName: String(data.displayName || '').trim().slice(0, 100) || 'Nudgr user',
    email: typeof data.email === 'string' ? data.email.trim().slice(0, 254) : null,
    updatedAt: FieldValue.serverTimestamp() };
}

function error(status, message) { return Object.assign(new Error(message), { status }); }

function createConnectionHandler({ auth = getAuth, firestore = getFirestore } = {}) {
return async function handleConnectByCode(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ message: 'Use POST.' });
  try {
    const bearer = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!bearer) throw error(401, 'Sign in to connect.');
    let identity;
    try { identity = await auth().verifyIdToken(bearer[1], true); }
    catch (_) { throw error(401, 'Sign in to connect.'); }
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(code)) throw error(400, 'Enter a valid connection code.');
    const db = firestore(), uid = identity.uid;
    const rateRef = db.collection('connectionRateLimits').doc(uid);
    const now = Date.now();
    // Commit failed attempts too: putting this in the connection transaction
    // would roll the budget back for invalid invitation codes.
    await db.runTransaction(async transaction => {
      const snap = await transaction.get(rateRef), previous = snap.exists ? snap.data() : {};
      const sameWindow = now - (previous.windowStartedAt || 0) < 60 * 60 * 1000;
      const attempts = sameWindow ? previous.attempts || 0 : 0;
      if (attempts >= 10) throw error(429, 'Too many attempts. Try again later.');
      transaction.set(rateRef, { attempts: attempts + 1, windowStartedAt: sameWindow ? previous.windowStartedAt : now });
    });
    const result = await db.runTransaction(async transaction => {
      const invitation = await transaction.get(db.collection('connectionCodes').doc(code));
      const otherUid = invitation.exists ? invitation.data().uid : null;
      if (!otherUid || otherUid === uid) throw error(400, 'Enter another person’s valid connection code.');
      const pair = [uid, otherUid].sort(), connectionId = pair.join('_');
      const connectionRef = db.collection('connections').doc(connectionId);
      const [existing, me, peer] = await Promise.all([
        transaction.get(connectionRef), transaction.get(db.collection('users').doc(uid)),
        transaction.get(db.collection('users').doc(otherUid)),
      ]);
      if (!me.exists || !peer.exists) throw error(409, 'Finish account setup before connecting.');
      if (peer.data().connectionCode !== code || peer.data().connectionCodeVersion !== 2) {
        throw error(400, 'Ask the other person for their current connection code.');
      }
      transaction.set(connectionRef, {
        connectionId, users: pair, status: 'connected', verification: 'invitation-code',
        verifiedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        ...(!existing.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
      }, { merge: true });
      for (const [owner, other] of [[uid, otherUid], [otherUid, uid]]) {
        transaction.set(db.collection('users').doc(owner).collection('connections').doc(other), {
          connectionId, status: 'connected', verification: 'invitation-code', createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      transaction.set(db.collection('profiles').doc(uid), profile(uid, me.data()));
      transaction.set(db.collection('profiles').doc(otherUid), profile(otherUid, peer.data()));
      return { connectionId, otherUid };
    });
    return res.status(200).json(result);
  } catch (failure) {
    return res.status(failure.status || 503).json({ message: failure.status ? failure.message : 'Connection service is temporarily unavailable.' });
  }
};
}
const handleConnectByCode = createConnectionHandler();
module.exports = { handleConnectByCode, createConnectionHandler, profile };
