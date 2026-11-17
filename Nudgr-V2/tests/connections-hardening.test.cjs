const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { randomUUID } = require('node:crypto');
const { Firestore } = require('../functions/node_modules/@google-cloud/firestore');
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('A loopback emulator is required.');
const db = new Firestore({ projectId: 'demo-nudgr-connections' });
after(() => db.terminate());
const { createConnectionHandler } = require('../functions/connections');
const handler = createConnectionHandler({ firestore: () => db, auth: () => ({ async verifyIdToken(token, revoked) {
  assert.equal(revoked, true);
  if (!token.startsWith('fixture-')) throw new Error('invalid');
  return { uid: token };
} }) });
async function connect(uid, code, headers = { authorization: `Bearer ${uid}` }) {
  let status, body;
  const res = { set() {}, status(value) { status = value; return this; }, json(value) { body = value; }, send(value) { body = value; } };
  await handler({ method: 'POST', headers, body: { code } }, res);
  return { status, body };
}
const unique = () => `fixture-${randomUUID()}`;

test('connection endpoint verifies Auth and does not accept a bare target UID', async () => {
  assert.equal((await connect(unique(), 'ABCDEFGH', {})).status, 401);
  assert.equal((await connect('invalid-identity', 'ABCDEFGH')).status, 401);
  assert.equal((await connect(unique(), unique())).status, 400);
});

test('invitation connection, mirrors and public profiles commit atomically and reconnect is idempotent', async () => {
  const uid = unique(), peer = unique(), code = 'ABCD2345';
  await db.doc(`users/${uid}`).set({ uid, displayName: 'Me', fcmTokens: { privateToken: true }, connectionCode: 'MECD2345' });
  await db.doc(`users/${peer}`).set({ uid: peer, displayName: ' Peer ', connectionCode: code, connectionCodeVersion: 2, fcmTokens: { privatePeerToken: true } });
  await db.doc(`connectionCodes/${code}`).set({ uid: peer });
  const first = await connect(uid, code);
  assert.equal(first.status, 200);
  const canonical = db.doc(`connections/${first.body.connectionId}`);
  const createdAt = (await canonical.get()).data().createdAt.toMillis();
  assert.equal((await db.doc(`users/${uid}/connections/${peer}`).get()).data().verification, 'invitation-code');
  assert.equal((await db.doc(`users/${peer}/connections/${uid}`).get()).data().verification, 'invitation-code');
  const publicProfile = (await db.doc(`profiles/${peer}`).get()).data();
  assert.equal(publicProfile.displayName, 'Peer');
  assert.equal(publicProfile.fcmTokens, undefined);
  assert.equal(publicProfile.connectionCode, undefined);
  assert.equal((await connect(uid, code)).status, 200);
  assert.equal((await canonical.get()).data().createdAt.toMillis(), createdAt);
  await db.doc(`users/${peer}`).update({ connectionCode: 'NEWC2345' });
  assert.equal((await connect(unique(), code)).status, 409);
  await db.doc(`users/${uid}`).set({ uid, connectionCode: 'MECD2345' });
  assert.equal((await connect(uid, code)).status, 400, 'a superseded reverse lookup must not authorize a connection');
});

test('failed guesses consume the rate budget and never create a connection', async () => {
  const uid = unique();
  for (let i = 0; i < 10; i++) assert.equal((await connect(uid, 'ZZZZ9999')).status, 400);
  assert.equal((await connect(uid, 'ZZZZ9999')).status, 429);
  assert.equal((await db.doc(`connectionRateLimits/${uid}`).get()).data().attempts, 10);
});

test('profile migration is read-only by default, excludes secrets and does not bless legacy connections', async () => {
  const { migratePrivateProfiles } = require('../functions/scripts/migrate-private-profiles.cjs');
  const uid = unique();
  await db.doc(`users/${uid}`).set({ uid, displayName: 'Migration', connectionCode: 'PRIV2345', fcmTokens: { fixtureSecret: true } });
  await db.doc('connectionCodes/PRIV2345').set({ uid });
  await db.doc(`connections/${uid}_legacy`).set({ users: [uid, 'legacy'], status: 'connected' });
  const dry = await migratePrivateProfiles(db);
  assert.equal(dry.mode, 'dry-run');
  assert.equal((await db.doc(`profiles/${uid}`).get()).exists, false);
  assert.equal((await db.doc(`users/${uid}`).get()).data().connectionCode, 'PRIV2345');
  assert.equal((await connect(unique(), 'PRIV2345')).status, 409);
  const requester = unique(); await db.doc(`users/${requester}`).set({ uid: requester });
  assert.equal((await connect(requester, 'PRIV2345')).status, 400, 'old exposed codes are not accepted');
  await migratePrivateProfiles(db, { apply: true });
  const migrated = (await db.doc(`users/${uid}`).get()).data();
  assert.equal(migrated.connectionCodeVersion, 2);
  assert.notEqual(migrated.connectionCode, 'PRIV2345');
  assert.equal((await db.doc('connectionCodes/PRIV2345').get()).exists, false);
  assert.equal((await connect(requester, migrated.connectionCode)).status, 200);
  const profile = (await db.doc(`profiles/${uid}`).get()).data();
  assert.deepEqual(Object.keys(profile).sort(), ['displayName', 'email', 'uid', 'updatedAt']);
  const devices = await db.collection(`users/${uid}/devices`).get();
  assert.equal(devices.size, 1);
  assert.equal(devices.docs[0].data().fcmToken, 'fixtureSecret');
  assert.equal((await db.doc(`connections/${uid}_legacy`).get()).data().verification, undefined);
  const again = await migratePrivateProfiles(db, { apply: true });
  assert.equal(again.counts.legacyDevices, 0);
  assert.equal(again.counts.rotatedInvitationCodes, 0);
  assert.equal((await db.doc(`users/${uid}`).get()).data().connectionCode, migrated.connectionCode);
});
