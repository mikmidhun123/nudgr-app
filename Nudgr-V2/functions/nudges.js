const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const DEFAULT_WORKER_URL =
  process.env.R2_WORKER_URL || 'https://nudgr-voice-api.mikmidhun123.workers.dev';

function httpError(status, message, code = 'NUDGE_DELETE_ERROR') {
  return Object.assign(new Error(message), { status, code });
}

async function fallbackRecursiveDelete(nudgeRef) {
  try {
    const triggersSnap = await nudgeRef.collection('triggerEvents').get();
    for (const trigDoc of triggersSnap.docs || []) {
      const receiptsSnap = await trigDoc.ref.collection('receipts').get();
      for (const recDoc of receiptsSnap.docs || []) {
        await recDoc.ref.delete();
      }
      await trigDoc.ref.delete();
    }
  } catch (_) {}
  await nudgeRef.delete();
}

function createNudgeDeletionHandler({
  auth = getAuth,
  firestore = getFirestore,
  fetchImpl = globalThis.fetch,
  workerUrl = DEFAULT_WORKER_URL,
} = {}) {
  return async function handleDeleteNudge(req, res) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'Use POST.' });

    try {
      const bearer = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
      if (!bearer || !bearer[1]) {
        throw httpError(401, 'Sign in to delete this Nudgr.', 'UNAUTHORIZED');
      }
      const rawToken = bearer[1].trim();
      let identity;
      try {
        identity = await auth().verifyIdToken(rawToken, true);
      } catch (_) {
        throw httpError(401, 'Sign in to delete this Nudgr.', 'UNAUTHORIZED');
      }

      const nudgeId = String(req.body?.nudgeId || '').trim();
      if (!nudgeId || nudgeId.length > 160 || nudgeId.includes('/')) {
        throw httpError(400, 'A valid nudgeId is required.', 'INVALID_NUDGE_ID');
      }

      const db = firestore();
      const nudgeRef = db.collection('nudges').doc(nudgeId);
      const snap = await nudgeRef.get();
      const exists = typeof snap.exists === 'function' ? snap.exists() : Boolean(snap.exists);

      if (!exists) {
        return res.status(200).json({ deleted: true, alreadyDeleted: true, nudgeId, voiceDeleted: false });
      }

      const nudge = snap.data() || {};
      if (nudge.senderUid !== identity.uid) {
        throw httpError(403, 'Only the sender who created this Nudgr can permanently delete it.', 'FORBIDDEN');
      }

      const storageKey = nudge.voiceNote?.storageKey;
      let voiceDeleted = false;

      if (typeof storageKey === 'string' && storageKey.startsWith(`voice/${identity.uid}/`)) {
        if (typeof fetchImpl !== 'function') {
          throw httpError(503, 'Voice storage gateway is unavailable.', 'VOICE_DELETE_UNAVAILABLE');
        }
        let voiceRes;
        try {
          voiceRes = await fetchImpl(`${workerUrl.replace(/\/$/, '')}/deleteVoice`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${rawToken}`,
            },
            body: JSON.stringify({ nudgeId, storageKey }),
          });
        } catch (err) {
          throw httpError(503, 'Could not reach Cloudflare R2 to delete voice recording. Please try again.', 'VOICE_DELETE_FAILED');
        }
        if (!voiceRes.ok && voiceRes.status !== 404) {
          throw httpError(503, 'Could not delete voice recording from Cloudflare R2. Please try again.', 'VOICE_DELETE_FAILED');
        }
        voiceDeleted = true;
      }

      if (typeof db.recursiveDelete === 'function') {
        await db.recursiveDelete(nudgeRef);
      } else {
        await fallbackRecursiveDelete(nudgeRef);
      }

      return res.status(200).json({
        deleted: true,
        nudgeId,
        voiceDeleted,
      });
    } catch (failure) {
      const status = failure.status || 503;
      return res.status(status).json({
        error: failure.code || 'NUDGE_DELETE_FAILED',
        message: failure.status ? failure.message : 'Deletion service is temporarily unavailable.',
      });
    }
  };
}

const handleDeleteNudge = createNudgeDeletionHandler();

module.exports = {
  handleDeleteNudge,
  createNudgeDeletionHandler,
};
