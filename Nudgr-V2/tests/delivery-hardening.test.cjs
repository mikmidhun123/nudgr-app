const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { randomUUID } = require('node:crypto');
const { Firestore, FieldValue, Timestamp } = require('../functions/node_modules/@google-cloud/firestore');
const { createDelivery } = require('../functions/delivery');
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw new Error('Delivery integration tests require a loopback Firestore emulator.');
}
const db = new Firestore({ projectId: 'demo-nudgr-delivery' });
after(() => db.terminate());

async function fixture({ tokens = ['token-a'], legacy = {}, devices, send, createdAgo = 0, event = {}, nudge = {} } = {}) {
  const id = `delivery-${randomUUID()}`, recipientUid = `${id}-recipient`, senderUid = `${id}-sender`;
  let clock = Date.now(), calls = [];
  const nudgeRef = db.doc(`nudges/${id}`), eventRef = nudgeRef.collection('triggerEvents').doc('t1');
  await nudgeRef.set({ senderUid, recipientUid, senderName: 'Alice', message: 'Hello', status: 'triggered', enabled: true, ...nudge });
  await db.doc(`connections/${[senderUid, recipientUid].sort().join('_')}`)
    .set({ users: [senderUid, recipientUid], status: 'connected', verification: 'invitation-code' });
  await db.doc(`users/${recipientUid}`).set({ fcmTokens: legacy });
  const records = devices || tokens.map((fcmToken, index) => ({ deviceId: `d${index}`, fcmToken, enabled: true }));
  for (let i = 0; i < records.length; i += 400) {
    const batch = db.batch();
    for (const device of records.slice(i, i + 400)) batch.set(db.doc(`users/${recipientUid}/devices/${device.deviceId}`), device);
    await batch.commit();
  }
  await eventRef.set({ nudgeId: id, senderUid, recipientUid, status: 'CREATED', deliveryVersion: 2,
    createdAt: Timestamp.fromMillis(clock - createdAgo), ...event });
  const original = await eventRef.get();
  const delivery = createDelivery({ getFirestore: () => db, FieldValue, now: () => clock,
    logger: { info() {}, warn() {}, error() {} }, getMessaging: () => ({ async sendEachForMulticast(payload) {
      calls.push(payload);
      if (send) return send(payload, calls.length);
      return { responses: payload.tokens.map(() => ({ success: true })) };
    } }),
  });
  return { id, recipientUid, eventRef, nudgeRef, calls, delivery,
    advance: ms => { clock += ms; }, read: async () => (await eventRef.get()).data(),
    run: () => delivery.deliver(original, { params: { nudgeId: id, triggerEventId: 't1' } }),
  };
}

test('concurrent creates and replayed original snapshots share one live claim', async () => {
  const f = await fixture();
  await Promise.all([f.run(), f.run(), f.run()]);
  await f.run();
  assert.equal(f.calls.length, 1);
  const state = await f.read();
  assert.equal(state.status, 'FCM_SENT');
  assert.equal(state.deliveryPending, false);
  assert.equal((await f.eventRef.collection('receipts').get()).size, 0, 'FCM acceptance is not a device receipt');
});

test('an abandoned send lease is reclaimed after its deadline', async () => {
  const f = await fixture();
  const now = Date.now();
  await f.eventRef.update({ status: 'FCM_SENDING', deliveryPending: true, deliveryLeaseId: 'abandoned',
    leaseUntilMs: now + 10000, nextAttemptAtMs: now + 10000, expiresAtMs: now + 300000, attemptCount: 1 });
  await f.run();
  assert.equal(f.calls.length, 0);
  f.advance(11000);
  await f.run();
  assert.equal(f.calls.length, 1);
  assert.equal((await f.read()).attemptCount, 2);
});

test('transient failures retry only unaccepted tokens and remove invalid registrations', async () => {
  const f = await fixture({ tokens: ['accepted', 'retry', 'invalid'], legacy: { invalid: true }, send: (_payload, count) => ({
    responses: count === 1 ? [{ success: true }, { error: { code: 'messaging/server-unavailable' } },
      { error: { code: 'messaging/registration-token-not-registered' } }] : [{ success: true }],
  }) });
  await f.run();
  assert.equal((await f.read()).deliveryPending, true);
  assert.equal((await db.doc(`users/${f.recipientUid}/devices/d2`).get()).exists, false);
  assert.deepEqual((await db.doc(`users/${f.recipientUid}`).get()).data().fcmTokens, {});
  f.advance(16000);
  await f.run();
  assert.deepEqual(f.calls[1].tokens, ['retry']);
  const state = await f.read();
  assert.equal(state.fcmSuccessCount, 2);
  assert.equal(state.fcmFailureCount, 1);
  assert.equal(state.deliveryPending, false);
  assert.equal(JSON.stringify(state).includes('accepted"'), false, 'shared trigger state contains hashes, never raw tokens');
});

test('500-token limit is respected and notification data stays bounded', async () => {
  const tokens = Array.from({ length: 501 }, (_, index) => `fixture-${index}`);
  const f = await fixture({ tokens, nudge: { senderName: '👩🏽‍💻'.repeat(100), message: '🚀'.repeat(4000) } });
  await f.run();
  assert.deepEqual(f.calls.map(call => call.tokens.length), [500, 1]);
  for (const payload of f.calls) {
    assert.ok(Buffer.byteLength(JSON.stringify(payload.data)) < 3000);
    assert.ok(payload.android.ttl <= 300000 && payload.android.ttl > 0);
    assert.equal(Number(payload.data.expiresAt), (await f.read()).expiresAtMs);
    const { validateMessage } = require('../functions/node_modules/firebase-admin/lib/messaging/messaging-internal');
    const single = JSON.parse(JSON.stringify(payload)); delete single.tokens; single.token = 'fixture';
    assert.doesNotThrow(() => validateMessage(single));
  }
  assert.equal((await f.read()).fcmSuccessCount, 501);
});

test('disabled installations suppress their legacy mirror and duplicates are deduplicated', async () => {
  const f = await fixture({ legacy: { disabled: true, enabled: true, legacyOnly: true }, devices: [
    { deviceId: 'd1', fcmToken: 'disabled', enabled: false },
    { deviceId: 'd2', fcmToken: 'enabled', enabled: true },
    { deviceId: 'd3', fcmToken: 'enabled', enabled: true },
  ] });
  await f.run();
  assert.deepEqual([...f.calls[0].tokens].sort(), ['enabled', 'legacyOnly']);
});

test('a disabled modern installation overrides a migrated legacy copy of the same token', async () => {
  const f = await fixture({ legacy: { loggedOut: true }, devices: [
    { deviceId: 'legacy_older', fcmToken: 'loggedOut', enabled: true, platform: 'legacy' },
    { deviceId: 'modern', fcmToken: 'loggedOut', enabled: false, platform: 'android' },
    { deviceId: 'fresh', fcmToken: 'current', enabled: true, platform: 'android' },
  ] });
  await f.run(); assert.deepEqual(f.calls[0].tokens, ['current']);
});

test('an offline observation retains its original expiry after reconnecting', async () => {
  const f = await fixture({ event: { observedAtMs: Date.now() - 301000 } });
  await f.run(); assert.equal(f.calls.length, 0); assert.equal((await f.read()).status, 'EXPIRED');
});

test('stale Android registrations are skipped and disabled without expiring iOS records', async () => {
  const stale = Timestamp.fromMillis(Date.now() - 271 * 86400000);
  const f = await fixture({ devices: [
    { deviceId: 'oldAndroid', fcmToken: 'stale-android', enabled: true, platform: 'android', updatedAt: stale },
    { deviceId: 'oldIos', fcmToken: 'ios', enabled: true, platform: 'ios', updatedAt: stale },
  ] });
  await f.run(); assert.deepEqual(f.calls[0].tokens, ['ios']);
  await f.delivery.expireStaleDevices();
  assert.equal((await db.doc(`users/${f.recipientUid}/devices/oldAndroid`).get()).data().enabled, false);
  assert.equal((await db.doc(`users/${f.recipientUid}/devices/oldIos`).get()).data().enabled, true);
});

test('an expired create cannot extend its deadline with client supplied expiry', async () => {
  const f = await fixture({ createdAgo: 301000, event: { expiresAtMs: Date.now() + 86400000 } });
  await f.run();
  assert.equal(f.calls.length, 0);
  assert.equal((await f.read()).status, 'EXPIRED');
});

test('retryable transport failures stop after the attempt budget', async () => {
  const f = await fixture({ send: () => { throw Object.assign(new Error('temporary'), { code: 'messaging/server-unavailable' }); } });
  for (let i = 0; i < 5; i++) { await f.run(); f.advance(15000 * (2 ** i) + 1); }
  const state = await f.read();
  assert.equal(state.attemptCount, 5);
  assert.equal(state.deliveryPending, false);
  await f.run();
  assert.equal(f.calls.length, 5);
});

test('parent cancellation and trigger identity changes fail closed', async () => {
  for (const nudge of [{ status: 'cancelled' }, { senderUid: 'another-sender' }, { enabled: false }]) {
    const f = await fixture({ nudge });
    await f.run();
    assert.equal(f.calls.length, 0);
    assert.equal((await f.read()).status, 'FCM_FAILED');
  }
});

test('scheduled recovery finds a due pending event without replaying the original trigger', async () => {
  const f = await fixture();
  await f.eventRef.update({ status: 'FCM_SENDING', deliveryPending: true, deliveryLeaseId: 'abandoned',
    leaseUntilMs: 1, nextAttemptAtMs: 1, expiresAtMs: Date.now() + 300000, attemptCount: 1 });
  await f.delivery.retryDue();
  assert.equal(f.calls.length, 1);
  assert.equal((await f.read()).status, 'FCM_SENT');
});
