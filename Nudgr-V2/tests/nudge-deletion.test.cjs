const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { generateKeyPairSync, sign, webcrypto } = require('node:crypto');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {} };

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'del-key', alg: 'RS256' };
const senderStorageKey = 'voice/sender/n1_1700000000.m4a';

function makeToken(uid = 'sender', overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (val) => Buffer.from(JSON.stringify(val)).toString('base64url');
  const input = `${encode({ alg: 'RS256', kid: 'del-key' })}.${encode({
    iss: 'https://securetoken.google.com/nudgr-e6049',
    aud: 'nudgr-e6049',
    sub: uid,
    user_id: uid,
    iat: now - 10,
    auth_time: now - 10,
    exp: now + 3600,
    ...overrides,
  })}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), keys.privateKey).toString('base64url')}`;
}

function createWorkerEnv({ docStatus = 200, docSender = 'sender', docKey = senderStorageKey } = {}) {
  const objects = new Map([[senderStorageKey, new Uint8Array([1, 2, 3, 4])]]);
  const deletedKeys = [];

  const code = babel.transformSync(fs.readFileSync(path.join(root, 'worker/index.js'), 'utf8'), {
    configFile: false,
    babelrc: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    console: quiet,
    Request,
    Response,
    Headers,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    atob,
    URL,
    crypto: webcrypto,
    fetch: async (url) => {
      if (String(url).includes('/jwk/')) {
        return Response.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'max-age=300' } });
      }
      if (docStatus === 404) {
        return new Response('', { status: 404 });
      }
      if (docStatus !== 200) {
        return new Response('', { status: docStatus });
      }
      return Response.json({
        fields: {
          senderUid: { stringValue: docSender },
          recipientUid: { stringValue: 'recipient' },
          voiceNote: { mapValue: { fields: { storageKey: { stringValue: docKey } } } },
        },
      });
    },
  });

  const env = {
    VOICE_BUCKET: {
      async get(key) {
        const buf = objects.get(key);
        return buf ? { body: buf, size: buf.byteLength, httpEtag: 'etag', httpMetadata: {} } : null;
      },
      async delete(key) {
        deletedKeys.push(key);
        objects.delete(key);
      },
    },
  };

  return {
    objects,
    deletedKeys,
    request(route, { method = 'POST', bearer, body } = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
      return exports.default.fetch(
        new Request(`https://voice.test${route}`, {
          method,
          headers,
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        env,
        {}
      );
    },
  };
}

test('Cloudflare Worker /deleteVoice and DELETE /media/* enforce auth, sender ownership, and remove R2 object', async () => {
  const w = createWorkerEnv();

  // 1. Unauthenticated rejected
  assert.equal((await w.request('/deleteVoice', { body: { nudgeId: 'n1', storageKey: senderStorageKey } })).status, 401);

  // 2. Recipient attempting to delete sender's voice recording rejected (403)
  assert.equal(
    (await w.request('/deleteVoice', { bearer: makeToken('recipient'), body: { nudgeId: 'n1', storageKey: senderStorageKey } })).status,
    403
  );

  // 3. Path traversal / malformed key rejected (400)
  assert.equal(
    (await w.request('/deleteVoice', { bearer: makeToken('sender'), body: { nudgeId: 'n1', storageKey: 'voice/sender/../other.m4a' } })).status,
    400
  );
  assert.equal(w.deletedKeys.length, 0);

  // 4. Valid sender deletes R2 voice recording -> 200 OK & removed from bucket
  const res = await w.request('/deleteVoice', {
    bearer: makeToken('sender'),
    body: { nudgeId: 'n1', storageKey: senderStorageKey },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(w.deletedKeys, [senderStorageKey]);
  assert.equal(w.objects.has(senderStorageKey), false);

  // 5. Subsequent GET /media/* returns 404
  const getAfter = await w.request(`/media/${senderStorageKey}?nudgeId=n1`, {
    method: 'GET',
    bearer: makeToken('recipient'),
  });
  assert.equal(getAfter.status, 404);

  // 6. Repeat DELETE via /media/* after Firestore doc is already gone (404) is idempotent (200)
  const wAfterDocGone = createWorkerEnv({ docStatus: 404 });
  const delMedia = await wAfterDocGone.request(`/media/${senderStorageKey}?nudgeId=n1`, {
    method: 'DELETE',
    bearer: makeToken('sender'),
  });
  assert.equal(delMedia.status, 200);
});

test('deleteNudge handler deletes R2 voice note and recursively deletes Firestore document & subcollections', async () => {
  const { createNudgeDeletionHandler } = require('../functions/nudges');
  const docs = new Map([
    [
      'nudges/n1',
      {
        senderUid: 'sender',
        recipientUid: 'recipient',
        voiceNote: { enabled: true, storageKey: senderStorageKey },
      },
    ],
  ]);
  const workerCalls = [];
  let recursiveDeletedRef = null;
  let workerShouldFail = false;

  const nudgeRef = {
    path: 'nudges/n1',
    async get() {
      return {
        exists: docs.has('nudges/n1'),
        data: () => docs.get('nudges/n1'),
      };
    },
    async delete() {
      docs.delete('nudges/n1');
    },
  };

  const handler = createNudgeDeletionHandler({
    auth: () => ({
      verifyIdToken: async (tok) => {
        if (tok === 'valid-sender') return { uid: 'sender' };
        if (tok === 'valid-recipient') return { uid: 'recipient' };
        throw new Error('Invalid token');
      },
    }),
    firestore: () => ({
      collection: () => ({ doc: () => nudgeRef }),
      recursiveDelete: async (ref) => {
        recursiveDeletedRef = ref.path;
        docs.delete(ref.path);
      },
    }),
    fetchImpl: async (url, opts) => {
      workerCalls.push({ url, opts });
      if (workerShouldFail) return new Response(JSON.stringify({ error: 'R2 down' }), { status: 500 });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
    workerUrl: 'https://voice.test',
  });

  function invoke({ method = 'POST', token, body }) {
    const res = {
      statusCode: 200,
      payload: null,
      set() {},
      status(c) {
        this.statusCode = c;
        return this;
      },
      send() {
        return this;
      },
      json(data) {
        this.payload = data;
        return this;
      },
    };
    return handler(
      {
        method,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body,
      },
      res
    ).then(() => res);
  }

  // 1. Unauthenticated rejected
  assert.equal((await invoke({ body: { nudgeId: 'n1' } })).statusCode, 401);

  // 2. Recipient cannot hard-delete sender's Nudgr (403)
  assert.equal((await invoke({ token: 'valid-recipient', body: { nudgeId: 'n1' } })).statusCode, 403);
  assert.equal(docs.has('nudges/n1'), true);

  // 3. If Worker R2 deletion fails (500), Firestore doc is NOT deleted so R2 audio is never orphaned
  workerShouldFail = true;
  assert.equal((await invoke({ token: 'valid-sender', body: { nudgeId: 'n1' } })).statusCode, 503);
  assert.equal(docs.has('nudges/n1'), true);
  assert.equal(recursiveDeletedRef, null);

  // 4. When Worker R2 succeeds, both R2 audio and Firestore document/subcollections are deleted
  workerShouldFail = false;
  const okRes = await invoke({ token: 'valid-sender', body: { nudgeId: 'n1' } });
  assert.equal(okRes.statusCode, 200);
  assert.deepEqual(okRes.payload, { deleted: true, nudgeId: 'n1', voiceDeleted: true });
  assert.equal(recursiveDeletedRef, 'nudges/n1');
  assert.equal(docs.has('nudges/n1'), false);

  // 5. Deleting an already-deleted Nudgr is idempotent (200)
  const repeatRes = await invoke({ token: 'valid-sender', body: { nudgeId: 'n1' } });
  assert.equal(repeatRes.statusCode, 200);
  assert.equal(repeatRes.payload.alreadyDeleted, true);
});

test('updateNudgeOnTrigger keeps repeating nudges active and marks one-shot nudges triggered', async () => {
  const rows = new Map([
    ['once1', { senderUid: 'alice', recipientUid: 'bob', status: 'active', enabled: true, repeatMode: 'once' }],
    ['daily1', { senderUid: 'alice', recipientUid: 'bob', status: 'active', enabled: true, repeatMode: 'once_per_day' }],
  ]);

  const firestore = {
    collection: () => ({
      doc: (id) => ({
        id,
        get: async () => ({ exists: rows.has(id), data: () => rows.get(id) }),
      }),
    }),
    runTransaction: async (cb) =>
      cb({
        get: (ref) => ref.get(),
        update: (ref, patch) => rows.set(ref.id, { ...rows.get(ref.id), ...patch }),
      }),
  };

  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8'), {
    exports,
    require(name) {
      if (name === 'firebase-admin/app') return { initializeApp() {} };
      if (name === 'firebase-admin/firestore') return { getFirestore: () => firestore, FieldValue: { serverTimestamp: () => 'ts' } };
      if (name === 'firebase-admin/messaging') return { getMessaging: () => ({}) };
      if (name === './delivery') return { createDelivery: () => ({ deliver() {}, retryDue() {}, expireStaleDevices() {} }) };
      return {
        firestore: { document: () => ({ onCreate: (fn) => fn, onWrite: (fn) => fn }) },
        https: { onRequest: (fn) => fn },
        pubsub: { schedule: () => ({ onRun: (fn) => fn }) },
        logger: quiet,
      };
    },
  });

  await exports.updateNudgeOnTrigger(
    { data: () => ({ senderUid: 'alice', recipientUid: 'bob' }) },
    { params: { nudgeId: 'once1', triggerEventId: 't1' } }
  );
  assert.equal(rows.get('once1').status, 'triggered');

  await exports.updateNudgeOnTrigger(
    { data: () => ({ senderUid: 'alice', recipientUid: 'bob' }) },
    { params: { nudgeId: 'daily1', triggerEventId: 't2' } }
  );
  assert.equal(rows.get('daily1').status, 'active');
});

test('connectByCode strips spaces/hyphens and connects via Firestore without requiring AbortSignal.timeout', async () => {
  const codesCode = babel.transformSync(fs.readFileSync(path.join(root, 'src/db/codes.js'), 'utf8'), {
    configFile: false,
    babelrc: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const codesExports = {};
  vm.runInNewContext(codesCode, {
    exports: codesExports,
    require: () => ({ uuid: { v4: () => '12345678-1234-4234-8234-1234567890ab' } }),
  });

  assert.equal(codesExports.normalizeConnectionCode(' ab 3x - yz k9 '), 'AB3XYZK9');

  const writes = [];
  const connCode = babel.transformSync(fs.readFileSync(path.join(root, 'src/db/connections.js'), 'utf8'), {
    configFile: false,
    babelrc: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;

  const makeCollection = (colName) => ({
    doc: (docId) => ({
      get: async () => ({
        exists: () => colName === 'connectionCodes' && docId === 'AB3XYZK9',
        data: () => (colName === 'connectionCodes' && docId === 'AB3XYZK9' ? { uid: 'peer_uid' } : null),
      }),
      set: async (payload, opts) => {
        writes.push({ path: `${colName}/${docId}`, payload, opts });
      },
      collection: (subName) => makeCollection(`${colName}/${docId}/${subName}`),
    }),
  });

  const connExports = {};
  vm.runInNewContext(connCode, {
    exports: connExports,
    console: quiet,
    setTimeout,
    clearTimeout,
    // Simulate Hermes where AbortSignal.timeout does not exist
    AbortController,
    AbortSignal: {},
    fetch: async () => new Response('<html>404 Not Found</html>', { status: 404 }),
    require(mod) {
      if (mod === './codes') return codesExports;
      if (mod === '../firebase') {
        return {
          isQaBuild: false,
          getApp: () => ({ options: { projectId: 'nudgr-e6049' } }),
          getAuth: () => ({
            currentUser: {
              uid: 'my_uid',
              getIdToken: async () => 'token123',
            },
          }),
          getFirestore: () => ({ collection: makeCollection }),
          getServerTimestamp: () => 'SERVER_TS',
        };
      }
      throw new Error(`Unexpected module: ${mod}`);
    },
  });

  const res = await connExports.connectByCode(' ab 3x - yz k9 ');
  assert.equal(res.otherUid, 'peer_uid');
  assert.equal(res.connectionId, 'my_uid_peer_uid');
  assert.equal(writes.length, 3);
  assert.equal(writes[0].path, 'connections/my_uid_peer_uid');
  assert.equal(writes[1].path, 'users/my_uid/connections/peer_uid');
  assert.equal(writes[2].path, 'users/peer_uid/connections/my_uid');
});
