#!/usr/bin/env node
const { createHash, randomBytes } = require('node:crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { profile } = require('../connections');

// Old codes may have been exposed by legacy profile reads. Never authorize them again.
async function rotateLegacyCode(db, userRef) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = [...randomBytes(8)].map(byte => alphabet[byte & 31]).join('');
    const result = await db.runTransaction(async transaction => {
      const user = await transaction.get(userRef), data = user.data();
      if (!user.exists || (data.connectionCodeVersion === 2 && /^[A-Z2-9]{8}$/.test(data.connectionCode || ''))) return 'current';
      const next = db.collection('connectionCodes').doc(code);
      if ((await transaction.get(next)).exists) return 'collision';
      const previous = /^[A-Z2-9]{8}$/.test(data.connectionCode || '')
        ? db.collection('connectionCodes').doc(data.connectionCode) : null;
      const old = previous ? await transaction.get(previous) : null;
      transaction.create(next, { uid: user.id, createdAt: FieldValue.serverTimestamp() });
      transaction.update(userRef, { connectionCode: code, connectionCodeVersion: 2, updatedAt: FieldValue.serverTimestamp() });
      if (old?.exists && old.data().uid === user.id) transaction.delete(previous);
      return 'rotated';
    });
    if (result !== 'collision') return result === 'rotated';
  }
  throw new Error('Could not reserve a fresh invitation code.');
}

/** Idempotent backfill. It never treats an old relationship as verified. */
async function migratePrivateProfiles(db, { apply = false } = {}) {
  const counts = { users: 0, profiles: 0, legacyDevices: 0, invitationCodesToRotate: 0, rotatedInvitationCodes: 0, unverifiedConnections: 0 };
  const users = await db.collection('users').get();
  for (const user of users.docs) {
    counts.users += 1; counts.profiles += 1;
    const data = user.data();
    if (data.connectionCodeVersion !== 2 || !/^[A-Z2-9]{8}$/.test(data.connectionCode || '')) counts.invitationCodesToRotate += 1;
    if (apply && await rotateLegacyCode(db, user.ref)) counts.rotatedInvitationCodes += 1;
    if (apply) await db.collection('profiles').doc(user.id).set(profile(user.id, data));
    for (const [token, enabled] of Object.entries(data.fcmTokens || {})) {
      if (!enabled || !token) continue;
      const deviceId = `legacy_${createHash('sha256').update(token).digest('hex')}`;
      const ref = user.ref.collection('devices').doc(deviceId);
      if ((await ref.get()).exists) continue;
      counts.legacyDevices += 1;
      if (apply) await ref.create({ uid: user.id, deviceId, fcmToken: token, enabled: true,
        platform: 'legacy', updatedAt: data.updatedAt || null });
    }
  }
  const connections = await db.collection('connections').get();
  counts.unverifiedConnections = connections.docs.filter(doc => doc.data().verification !== 'invitation-code').length;
  return { mode: apply ? 'apply' : 'dry-run', counts, requiresConnectionCodes: counts.unverifiedConnections > 0 };
}

if (require.main === module) {
  const args = process.argv.slice(2), index = args.indexOf('--project');
  const projectId = index >= 0 ? args[index + 1] : null;
  if (!projectId || projectId.startsWith('--')) throw new Error('An explicit --project PROJECT_ID is required. Default mode is read-only.');
  if (args.includes('--emulator') && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
    throw new Error('--emulator requires a loopback FIRESTORE_EMULATOR_HOST.');
  }
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ projectId });
  migratePrivateProfiles(getFirestore(), { apply: args.includes('--apply') })
    .then(result => console.log(JSON.stringify({ projectId, ...result }, null, 2)))
    .catch(error => { console.error(`Migration failed: ${error.code || 'unknown'}`); process.exitCode = 1; });
}
module.exports = { migratePrivateProfiles };
