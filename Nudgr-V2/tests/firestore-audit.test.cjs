const assert = require('node:assert/strict');
const { test } = require('node:test');

// This suite deliberately refuses non-loopback endpoints and never uses production.
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
  throw new Error('Set FIRESTORE_EMULATOR_HOST to a loopback Firestore emulator');
}
const project = 'demo-nudgr-audit';
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const prefix = `audit-${Date.now()}`;
const encode = value => value === null ? { nullValue: null }
  : typeof value === 'string' ? { stringValue: value }
  : typeof value === 'boolean' ? { booleanValue: value }
  : typeof value === 'number' ? { doubleValue: value }
  : Array.isArray(value) ? { arrayValue: { values: value.map(encode) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } };
function jwt(uid) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${project}`, aud: project, sub: uid, user_id: uid,
    iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'custom' },
  })}.`;
}
async function request(document, { uid, admin = false, fields, mask, method = fields ? 'PATCH' : 'GET' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin || uid) headers.Authorization = `Bearer ${admin ? 'owner' : jwt(uid)}`;
  const query = mask ? `?${mask.map(field => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&')}` : '';
  return fetch(`${base}/${document}${query}`, {
    method, headers, signal: AbortSignal.timeout(30000),
    ...(fields ? { body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encode(v)])) }) } : {}),
  });
}
async function seed(document, fields) {
  const response = await request(document, { admin: true, fields });
  assert.equal(response.status, 200, await response.text());
}
async function trigger(uid, id, eventId = 't1') {
  const name = document => `projects/${project}/databases/(default)/documents/${document}`;
  const event = { nudgeId: id, triggerEventId: eventId, senderUid: 'sender', recipientUid: 'recipient',
    status: 'CREATED', deliveryVersion: 2, observedAtMs: Date.now(), triggerLatitude: 12.97, triggerLongitude: 77.59 };
  const parent = { status: 'triggered', lastTriggerEventId: eventId, lastTriggerExpiresAtMs: event.observedAtMs + 300000 };
  const write = (document, fields, timestamps) => ({ update: { name: name(document),
    fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)])) },
    updateMask: { fieldPaths: Object.keys(fields) },
    updateTransforms: timestamps.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })),
  });
  return fetch(`${base}:commit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt(uid)}` },
    body: JSON.stringify({ writes: [write(`nudges/${id}/triggerEvents/${eventId}`, event, ['createdAt', 'updatedAt', 'triggeredAt']),
      write(`nudges/${id}`, parent, ['lastTriggeredAt', 'triggeredAt', 'updatedAt'])] }),
  });
}
const nudge = { senderUid: 'sender', recipientUid: 'recipient', message: 'Hello', status: 'active', enabled: true,
  triggerLatitude: 12.97, triggerLongitude: 77.59, radiusKm: 2.5, voiceNote: null };

test('profile writes are owner-only and unauthenticated reads are denied', async () => {
  const id = `${prefix}-owner`;
  assert.equal((await request(`users/${id}`, { uid: id, fields: { uid: id, displayName: 'Owner' } })).status, 200);
  assert.equal((await request(`users/${id}`, { uid: 'stranger', fields: { displayName: 'Injected' }, mask: ['displayName'] })).status, 403);
  assert.equal((await request(`users/${id}`)).status, 403);
});

test('recipient completion and pause work while payload tampering is denied', async () => {
  const id = `${prefix}-recipient`;
  await seed(`nudges/${id}`, nudge);
  assert.equal((await request(`nudges/${id}`, { uid: 'recipient', fields: { enabled: false, disableMode: 'manual' }, mask: ['enabled', 'disableMode'] })).status, 200);
  assert.equal((await request(`nudges/${id}`, { uid: 'recipient', fields: { status: 'completed' }, mask: ['status'] })).status, 200);
  assert.equal((await request(`nudges/${id}`, { uid: 'recipient', fields: { status: 'completed', message: 'Injected', radiusKm: 99 }, mask: ['status', 'message', 'radiusKm'] })).status, 403);
});

test('nudge identities and reads remain restricted to participants', async () => {
  const id = `${prefix}-identities`;
  await seed(`nudges/${id}`, nudge);
  assert.equal((await request(`nudges/${id}`, { uid: 'stranger' })).status, 403);
  assert.equal((await request(`nudges/${id}`, { uid: 'sender', fields: { recipientUid: 'other' }, mask: ['recipientUid'] })).status, 403);
});

test('only sender can create trigger; clients cannot forge FCM success or event identities', async () => {
  await seed('connections/recipient_sender', { users: ['recipient', 'sender'], status: 'connected', verification: 'invitation-code' });
  const id = `${prefix}-trigger`, event = `nudges/${id}/triggerEvents/t1`;
  await seed(`nudges/${id}`, nudge);
  assert.equal((await trigger('recipient', id)).status, 403);
  const created = await trigger('sender', id);
  assert.equal(created.status, 200, await created.text());
  assert.equal((await request(event, { uid: 'sender', fields: { status: 'FCM_SENT' }, mask: ['status'] })).status, 403);
  assert.equal((await request(event, { uid: 'sender', fields: { recipientUid: 'other', status: 'COMPLETED' }, mask: ['recipientUid', 'status'] })).status, 403);
  assert.equal((await request(event, { uid: 'sender', fields: { status: 'COMPLETED' }, mask: ['status'] })).status, 403);
  assert.equal((await request(`nudges/${id}`, { uid: 'sender', fields: { lastTriggeredAt: null }, mask: ['lastTriggeredAt'] })).status, 403);
  assert.equal((await request(`nudges/${id}`, { uid: 'sender', fields: { status: 'active' }, mask: ['status'] })).status, 200);
  assert.equal((await trigger('sender', id, 't2')).status, 403);
});

test('connected peers cannot read private token maps and can read only safe profiles', async () => {
  await seed('users/token-owner', { uid: 'token-owner', fcmTokens: { fixtureToken: true } });
  await seed('users/token-peer/connections/token-owner', { connectionId: 'fixture' });
  await seed('connections/token-owner_token-peer', { users: ['token-owner', 'token-peer'], status: 'connected', verification: 'invitation-code' });
  await seed('profiles/token-owner', { uid: 'token-owner', displayName: 'Peer', email: null });
  const response = await request('users/token-owner', { uid: 'token-peer' });
  assert.equal(response.status, 403);
  assert.equal((await request('users/token-owner', { uid: 'token-owner' })).status, 200);
  assert.equal((await request('profiles/token-owner', { uid: 'token-peer' })).status, 200);
  assert.equal((await request('profiles/token-owner', { uid: 'stranger' })).status, 403);
  assert.equal((await request('profiles/token-owner', { uid: 'token-owner', fields: { fcmTokens: { bad: true } }, mask: ['fcmTokens'] })).status, 403);
});

test('clients cannot forge canonical connections or per-user mirrors', async () => {
  const users = [`${prefix}-a`, `${prefix}-b`].sort(), id = users.join('_');
  const response = await request(`connections/${id}`, { uid: users[0], fields: { connectionId: id, users, status: 'connected' } });
  assert.equal(response.status, 403);
  assert.equal((await request(`users/${users[0]}/connections/${users[1]}`, { uid: users[0], fields: { connectionId: id } })).status, 403);
});

test('nudge creation requires a connected recipient and valid payload geometry', async () => {
  const senderUid = `${prefix}-new-sender`, recipientUid = `${prefix}-new-recipient`;
  const payload = { ...nudge, senderUid, recipientUid };
  assert.equal((await request(`nudges/${prefix}-unconnected`, { uid: senderUid, fields: payload })).status, 403);
  const pair = [senderUid, recipientUid].sort();
  await seed(`connections/${pair.join('_')}`, { users: pair, status: 'connected', verification: 'invitation-code' });
  assert.equal((await request(`nudges/${prefix}-connected`, { uid: senderUid, fields: payload })).status, 200);
  for (const changed of [{ radiusKm: 99 }, { triggerLatitude: 91 }, { voiceNote: { storageKey: 'voice/victim/file.m4a' } },
    { message: { invalid: true } }, { enabled: 'yes' }, { senderName: { invalid: true } },
    { schedule: { activeAfter: 'tomorrow' } }, { voiceUrl: 'http://127.0.0.1/private' }]) {
    assert.equal((await request(`nudges/${prefix}-invalid-${Object.keys(changed)[0]}`, { uid: senderUid, fields: { ...payload, ...changed } })).status, 403);
  }
});

test('future activation cannot be bypassed by an otherwise valid atomic trigger', async () => {
  const id = `${prefix}-future-activation`;
  await seed(`nudges/${id}`, { ...nudge, schedule: { activeAfter: Date.now() + 3600000 }, status: 'scheduled' });
  assert.equal((await trigger('sender', id)).status, 403);
});

test('private device records validate owner and token fields', async () => {
  const path = `users/${prefix}-device-owner/devices/d1`;
  const payload = { uid: `${prefix}-device-owner`, deviceId: 'd1', fcmToken: 'fixture-private-token', enabled: true, platform: 'android' };
  assert.equal((await request(path, { uid: payload.uid, fields: payload })).status, 200);
  assert.equal((await request(path, { uid: 'stranger' })).status, 403);
  assert.equal((await request(path, { uid: payload.uid, fields: { uid: 'stranger' }, mask: ['uid'] })).status, 403);
});

test('recipient receipts are distinct from backend transport state and cannot undo Answer', async () => {
  const id = `${prefix}-receipt`;
  await seed(`nudges/${id}`, nudge);
  await seed(`nudges/${id}/triggerEvents/t1`, { status: 'FCM_SENT' });
  const write = async (uid, state) => fetch(`${base}:commit`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt(uid)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: [{ update: { name: `projects/${project}/databases/(default)/documents/nudges/${id}/triggerEvents/t1/receipts/d1`,
      fields: { deviceId: encode('d1'), recipientUid: encode('recipient'), state: encode(state) } },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }] }),
  });
  assert.equal((await write('sender', 'RECEIVED')).status, 403);
  assert.equal((await write('recipient', 'RECEIVED')).status, 200);
  assert.equal((await write('recipient', 'ANSWERED')).status, 200);
  assert.equal((await write('recipient', 'MISSED')).status, 403);
  assert.equal((await request(`nudges/${id}/triggerEvents/t1`, { uid: 'recipient', fields: { status: 'FCM_SENT' }, mask: ['status'] })).status, 403);
});

test('repeating nudges stay active on trigger, enforce daily/cooldown rules, and protect against recipient completion', async () => {
  await seed('connections/recipient_sender', { users: ['recipient', 'sender'], status: 'connected', verification: 'invitation-code' });
  const dailyId = `${prefix}-daily`;
  const tzOffset = 330;
  const todayIdx = Math.floor((Date.now() + tzOffset * 60000) / 86400000);
  await seed(`nudges/${dailyId}`, {
    ...nudge,
    repeatMode: 'once_per_day',
    timezoneOffsetMinutes: tzOffset,
    recipientHidden: false,
  });

  // Recipient can hide a received repeating nudge, but CANNOT mark it 'completed'
  assert.equal((await request(`nudges/${dailyId}`, { uid: 'recipient', fields: { recipientHidden: true }, mask: ['recipientHidden'] })).status, 200);
  assert.equal((await request(`nudges/${dailyId}`, { uid: 'recipient', fields: { status: 'completed' }, mask: ['status'] })).status, 403);

  // Sender turning the nudge ON resets recipientHidden to false
  assert.equal((await request(`nudges/${dailyId}`, { uid: 'sender', fields: { enabled: true, recipientHidden: false }, mask: ['enabled', 'recipientHidden'] })).status, 200);

  // Atomic trigger on repeating nudge keeps parent status == 'active' and sets lastTriggeredDayIndex
  const name = document => `projects/${project}/databases/(default)/documents/${document}`;
  const observedAtMs = Date.now();
  const write = (document, fields, timestamps) => ({
    update: { name: name(document), fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)])) },
    updateMask: { fieldPaths: Object.keys(fields) },
    updateTransforms: timestamps.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })),
  });
  const triggerDaily = (eventId) => fetch(`${base}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt('sender')}` },
    body: JSON.stringify({
      writes: [
        write(`nudges/${dailyId}/triggerEvents/${eventId}`, {
          nudgeId: dailyId, triggerEventId: eventId, senderUid: 'sender', recipientUid: 'recipient',
          status: 'CREATED', deliveryVersion: 2, observedAtMs, triggerLatitude: 12.97, triggerLongitude: 77.59,
        }, ['createdAt', 'updatedAt', 'triggeredAt']),
        write(`nudges/${dailyId}`, {
          status: 'active', lastTriggerEventId: eventId, lastTriggerExpiresAtMs: observedAtMs + 300000,
          lastTriggeredDayIndex: todayIdx, lastTriggeredDate: '2026-11-17',
        }, ['lastTriggeredAt', 'triggeredAt', 'updatedAt']),
      ],
    }),
  });

  const firstRes = await triggerDaily('d1');
  assert.equal(firstRes.status, 200, await firstRes.text());

  // Second trigger on the same local calendar day is rejected by Firestore rules
  const secondRes = await triggerDaily('d2');
  assert.equal(secondRes.status, 403);
});
