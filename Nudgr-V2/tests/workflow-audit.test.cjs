const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { generateKeyPairSync, sign, webcrypto } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const babel = require('@babel/core');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {} };

function source(file) {
  return process.env.AUDIT_SOURCE_BASELINE === '1'
    ? execFileSync('git', ['show', `HEAD:Nudgr-V2/${file}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, file), 'utf8');
}

function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  const code = babel.transformSync(source(file), {
    configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  vm.runInNewContext(code, {
    exports, console: quiet, __DEV__: false, setTimeout, clearTimeout,
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    }, ...globals,
  });
  return exports;
}

function uiHandler(file, name, globals) {
  const text = source(file);
  const ast = parser.parse(text, { sourceType: 'module', plugins: ['jsx'] });
  let declaration;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id.name === name) declaration = node;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  assert.ok(declaration);
  const context = { ...globals, console: quiet, __DEV__: false };
  vm.runInNewContext(`globalThis.handler = ${text.slice(declaration.init.start, declaration.init.end)};`, context);
  return context.handler;
}

test('logout waits for owner-authorized token removal before signing out', async () => {
  let signedIn = true, release;
  const removal = new Promise(resolve => { release = resolve; });
  const handler = uiHandler('App.js', 'handleSignOut', {
    getAuth: () => ({ currentUser: { uid: 'sender' }, signOut: async () => { signedIn = false; } }),
    removeFcmToken: async () => { assert.equal(signedIn, true); await removal; },
    setTimeout, clearTimeout,
  });
  const done = handler();
  assert.equal(signedIn, true);
  release();
  await done;
  assert.equal(signedIn, false);
});

test('recipient schedule without a location reports an error before creating a local test', async () => {
  const errors = [];
  let created = 0;
  const submit = uiHandler('src/ui/CreateNudgeScreen.js', 'submit', {
    recipientUid: 'recipient', message: 'Hello', trigger: null, schedule: 'afterTime', recordedVoice: null,
    setError: value => errors.push(value), setBusy() {}, setBusyStatus() {},
    submitWithData: async () => { created++; },
  });
  await submit();
  assert.equal(created, 0);
  assert.match(errors[0], /location.*recipient/i);
});

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'audit-key', alg: 'RS256' };
const storageKey = 'voice/sender/note.m4a';
function token(uid = 'sender', overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'RS256', kid: 'audit-key' })}.${encode({
    iss: 'https://securetoken.google.com/nudgr-e6049', aud: 'nudgr-e6049',
    sub: uid, user_id: uid, iat: now - 10, auth_time: now - 10, exp: now + 3600, ...overrides,
  })}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), keys.privateKey).toString('base64url')}`;
}

function workerFixture({ denied = false, lookupFailure = false, declaredStorageKey = storageKey } = {}) {
  const writes = [], reads = [];
  const gateway = load('worker/index.js', {}, {
    Request, Response, Headers, TextEncoder, TextDecoder, Uint8Array, atob, URL, crypto: webcrypto,
    fetch: async url => {
      if (String(url).includes('/jwk/')) return Response.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'max-age=300' } });
      if (lookupFailure) throw new Error('Firestore unavailable');
      return denied ? new Response('', { status: 403 }) : Response.json({ fields: {
        senderUid: { stringValue: 'sender' }, recipientUid: { stringValue: 'recipient' },
        voiceNote: { mapValue: { fields: { storageKey: { stringValue: declaredStorageKey } } } },
      } });
    },
  }).default;
  const env = { VOICE_BUCKET: {
    async put(key, body) { writes.push(key); return { size: body.byteLength, httpEtag: 'test' }; },
    async get(key) { reads.push(key); return { body: new Uint8Array([1, 2]), size: 2, httpEtag: 'test', httpMetadata: {} }; },
  } };
  return {
    writes, reads,
    request(route, { method = 'POST', bearer, body, type = 'application/json' } = {}) {
      const headers = { 'Content-Type': type };
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
      return gateway.fetch(new Request(`https://voice.test${route}`, {
        method, headers, ...(body === undefined ? {} : { body: typeof body === 'object' && !(body instanceof Uint8Array) ? JSON.stringify(body) : body }),
      }), env, {});
    },
  };
}

test('voice gateway rejects forged signatures and unsigned identity claims', async () => {
  const valid = token();
  for (const forged of [valid.replace(/\.[^.]+$/, '.AA'), `e30.${Buffer.from('{"sub":"sender"}').toString('base64url')}.AA`]) {
    const f = workerFixture();
    assert.equal((await f.request('/getVoiceUploadUrl', { bearer: forged, body: {} })).status, 401);
    assert.equal(f.writes.length, 0);
  }
});

test('voice gateway requires issuer, audience, expiry and matching subject', async () => {
  for (const claims of [{ exp: 1 }, { exp: null }, { iss: null }, { aud: 'other' }, { sub: '' }, { user_id: 'other' }, { auth_time: null }]) {
    assert.equal((await workerFixture().request('/getVoiceUploadUrl', { bearer: token('sender', claims), body: {} })).status, 401);
  }
});

test('voice media rejects unauthenticated GET and HEAD before reading R2', async () => {
  for (const method of ['GET', 'HEAD']) {
    const f = workerFixture();
    assert.equal((await f.request(`/media/${storageKey}?nudgeId=n1`, { method })).status, 401);
    assert.equal(f.reads.length, 0);
  }
});

test('voice gateway verifies participant and exact document storage key', async () => {
  const body = { nudgeId: 'n1', storageKey };
  assert.equal((await workerFixture().request('/getVoiceDownloadUrl', { bearer: token('recipient'), body })).status, 200);
  for (const [fixture, candidate, uid] of [
    [workerFixture(), body, 'stranger'],
    [workerFixture(), { ...body, storageKey: 'voice/sender/other.m4a' }, 'sender'],
    [workerFixture(), { storageKey }, 'sender'],
    [workerFixture({ denied: true }), body, 'sender'],
    [workerFixture({ lookupFailure: true }), body, 'sender'],
    [workerFixture({ declaredStorageKey: 'voice/victim/private.m4a' }), { nudgeId: 'n1', storageKey: 'voice/victim/private.m4a' }, 'sender'],
  ]) assert.equal((await fixture.request('/getVoiceDownloadUrl', { bearer: token(uid), body: candidate })).status, 403);
});

test('authorized media playback works with bearer headers and no token in URL', async () => {
  const f = workerFixture();
  const response = await f.request('/getVoiceDownloadUrl', { bearer: token('recipient'), body: { nudgeId: 'n1', storageKey } });
  const { downloadUrl } = await response.json();
  assert.equal(new URL(downloadUrl).searchParams.has('token'), false);
  const media = await f.request(new URL(downloadUrl).pathname + new URL(downloadUrl).search, { method: 'GET', bearer: token('recipient') });
  assert.equal(media.status, 200);
  assert.deepEqual(Array.from(new Uint8Array(await media.arrayBuffer())), [1, 2]);
  assert.match(media.headers.get('Cache-Control'), /no-store/);
});

test('uploads enforce ownership, content type and actual body size', async () => {
  const f = workerFixture();
  assert.equal((await f.request('/upload/voice/other/note.m4a', { method: 'PUT', bearer: token(), body: new Uint8Array([1]), type: 'audio/m4a' })).status, 403);
  assert.equal((await f.request(`/upload/${storageKey}`, { method: 'PUT', bearer: token(), body: 'html', type: 'text/html' })).status, 415);
  assert.equal((await f.request(`/upload/${storageKey}`, { method: 'PUT', bearer: token(), body: new Uint8Array(10 * 1024 * 1024 + 1), type: 'audio/m4a' })).status, 413);
  assert.equal(f.writes.length, 0);
  assert.equal((await f.request(`/upload/${storageKey}`, { method: 'PUT', bearer: token(), body: new Uint8Array([1]), type: 'audio/m4a' })).status, 200);
  assert.deepEqual(f.writes, [storageKey]);
});

function nudgesFixture(globals = {}) {
  const writes = [];
  const firebase = {
    getAuth: () => ({ currentUser: { uid: 'sender', displayName: 'Sender' } }),
    getServerTimestamp: () => 1,
    getFirestore: () => ({ collection: () => ({
      add: async data => { writes.push(data); return { id: 'n1' }; },
      doc: () => ({ update: async data => writes.push(data) }),
    }) }),
  };
  return { ...load('src/db/nudges.js', { '../firebase': firebase }, globals), writes, firebase };
}

test('creation accepts radius endpoints and rejects nonfinite/out-of-range geometry', async () => {
  const f = nudgesFixture();
  const valid = { recipientUid: 'recipient', message: 'Hello', triggerLatitude: 12, triggerLongitude: 77, radiusKm: 2.5 };
  for (const radiusKm of [2.5, 10]) await f.createNudge({ ...valid, radiusKm });
  for (const invalid of [{ radiusKm: 0 }, { radiusKm: 10.1 }, { radiusKm: NaN }, { radiusKm: Infinity }, { triggerLatitude: 91 }, { triggerLongitude: -181 }, { triggerLatitude: NaN }]) {
    await assert.rejects(f.createNudge({ ...valid, ...invalid }));
  }
  assert.equal(f.writes.length, 2);
});

test('today-only pause ends at the local day boundary across UTC midnight', async () => {
  const previousTz = process.env.TZ;
  process.env.TZ = 'Asia/Kolkata';
  try {
    const now = new Date('2026-10-30T19:00:00Z'); // Oct 31, 00:30 IST.
    class AuditDate extends Date { constructor(...args) { super(...(args.length ? args : [now.getTime()])); } }
    const f = nudgesFixture({ Date: AuditDate });
    const pausedYesterday = { status: 'active', enabled: false, disableMode: 'today', disabledUntilDate: '2026-10-30', disabledUntil: new Date('2026-10-30T18:29:59Z').getTime() };
    assert.equal(f.isNudgeActive(pausedYesterday, now), true);
    await f.setNudgeEnabled('n1', false, 'today');
    assert.equal(f.writes[0].disabledUntilDate, '2026-10-31');
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
});

test('trigger transaction rejects stale paused/cancelled/wrong-owner candidates', async () => {
  for (const changes of [{ enabled: false, disableMode: 'manual' }, { status: 'cancelled' }, { status: 'completed' }, { senderUid: 'other' }]) {
    let writes = 0;
    const parent = { senderUid: 'sender', recipientUid: 'recipient', status: 'active', enabled: true, ...changes };
    const f = nudgesFixture();
    const geo = load('src/location/geoUtils.js');
    const eventRef = {};
    const parentRef = { collection: () => ({ doc: () => eventRef }) };
    const triggers = load('src/db/triggers.js', {
      '../firebase': { ...f.firebase, getFirestore: () => ({ collection: () => ({ doc: () => parentRef }),
        runTransaction: async callback => callback({ get: async ref => ({ exists: () => ref === parentRef, data: () => parent }), set: () => writes++, update: () => writes++ }),
      }) },
      './nudges': f, '../location/geoUtils': geo,
    });
    assert.equal((await triggers.createTriggerEvent('n1', { triggerLatitude: 12, triggerLongitude: 77 })).created, false);
    assert.equal(writes, 0);
  }
});

test('existing profile is repaired after signup display-name update', async () => {
  const writes = [];
  const data = { uid: 'sender', connectionCode: 'ABCDEFGH', displayName: null };
  const profiles = load('src/db/users.js', {
    '../firebase': { getServerTimestamp: () => 1, getFirestore: () => ({ collection: collection => ({ doc: () => ({
      get: async () => ({ exists: () => true, data: () => collection === 'users' ? data : { uid: 'sender' } }),
      set: async update => writes.push(update),
    }) }) }) }, './codes': { generateConnectionCode: () => 'ABCDEFGH' },
  });
  assert.equal((await profiles.ensureUserProfile({ uid: 'sender', displayName: ' Alice ' })).displayName, 'Alice');
  assert.equal(writes[0].displayName, 'Alice');
});

test('legacy voice Functions fail closed for missing documents, keys, ownership and lookup errors', async () => {
  for (const variant of ['missing-id', 'missing-doc', 'wrong-user', 'wrong-key', 'lookup-error']) {
    let signed = false;
    const holder = { exports: {} };
    const deps = name => {
      if (name === 'firebase-admin/auth') return { getAuth: () => ({ verifyIdToken: async () => ({ uid: 'sender' }) }) };
      if (name === 'firebase-admin/firestore') return { getFirestore: () => ({ collection: () => ({ doc: () => ({ get: async () => {
        if (variant === 'lookup-error') throw new Error('offline');
        return { exists: variant !== 'missing-doc', data: () => ({ senderUid: variant === 'wrong-user' ? 'other' : 'sender', recipientUid: 'recipient', voiceNote: { storageKey: variant === 'wrong-key' ? 'other' : storageKey } }) };
      } }) }) }) };
      if (name === 'firebase-admin') return { auth: () => ({ verifyIdToken: async () => ({ uid: 'sender' }) }), firestore: () => { throw new Error('Legacy SDK namespace'); } };
      if (name === '@aws-sdk/client-s3') return { S3Client: class {}, GetObjectCommand: class {} };
      if (name === '@aws-sdk/s3-request-presigner') return { getSignedUrl: async () => { signed = true; return 'signed'; } };
      throw new Error(name);
    };
    vm.runInNewContext(source('functions/r2.js'), { module: holder, console: quiet, process: { env: { R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test' } }, require: deps });
    const res = { statusCode: 200, set() {}, status(value) { this.statusCode = value; return this; }, json() { return this; } };
    await holder.exports.handleGetVoiceDownloadUrl({ method: 'POST', headers: { authorization: 'Bearer test' }, body: { ...(variant === 'missing-id' ? {} : { nudgeId: 'n1' }), storageKey } }, res);
    assert.ok(res.statusCode >= 400, variant);
    assert.equal(signed, false, variant);
  }
});
const cases = [true, false];
for (const started of cases) test(`recording UI waits for native readiness and handles start=${started}`, async () => {
  const states = [], errors = []; let release;
  const ready = new Promise(resolve => { release = resolve; });
  const handler = uiHandler('src/ui/CreateNudgeScreen.js', 'handleStartRecord', {
    setMicError: value => errors.push(value), hasMicPermission: async () => true,
    setRecordedVoice() {}, setRecordingSeconds() {}, setIsRecording: value => states.push(value),
    startRecording: () => ready,
  });
  const operation = handler(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(states, []);
  release(started); await operation;
  assert.deepEqual(states, started ? [true] : []);
  assert.deepEqual(errors, [null]);
});
