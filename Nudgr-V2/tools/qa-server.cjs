/* Local QA adapter. Firestore always stays on loopback; live FCM requires an explicit flag. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { webcrypto, createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const fnRequire = createRequire(path.join(root, 'functions/package.json'));
const express = fnRequire('express');
const argv = process.argv.slice(2);
const option = name => argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
const projectId = option('--project') || 'demo-nudgr-ci';
const liveFcm = argv.includes('--live-fcm');
const port = Number(option('--port') || 5008), firestorePort = Number(option('--firestore-port') || 8088);
process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${firestorePort}`;
if (!Number.isInteger(port) || !Number.isInteger(firestorePort) || /[^a-z0-9-]/.test(projectId)) throw new Error('Invalid local QA configuration.');
if (!liveFcm) process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';

async function main() {
  const { initializeApp } = fnRequire('firebase-admin/app');
  const { getAuth } = fnRequire('firebase-admin/auth');
  const { FieldValue } = fnRequire('firebase-admin/firestore');
  const { Firestore } = fnRequire('@google-cloud/firestore');
  const { getMessaging } = fnRequire('firebase-admin/messaging');
  let credential;
  if (liveFcm) {
    const toolsDir = option('--firebase-tools-dir');
    if (!toolsDir) throw new Error('--live-fcm requires an existing --firebase-tools-dir login.');
    const toolsAuth = require(path.resolve(toolsDir, 'lib/auth.js'));
    require(path.resolve(toolsDir, 'lib/logger.js')).logger.silent = true;
    const account = toolsAuth.getProjectDefaultAccount(root);
    if (!account?.tokens?.refresh_token) throw new Error('An existing Firebase CLI login is required.');
    credential = { async getAccessToken() {
      const token = await toolsAuth.getAccessToken(account.tokens.refresh_token, [
        'https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase',
      ]);
      const expiresAt = Number(token.expires_at);
      if (!token.access_token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error('The local QA login could not supply a fresh access token.');
      }
      return { access_token: token.access_token,
        expires_in: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)) };
    } };
    await credential.getAccessToken(); // Fail before listening; never print credentials.
  }
  initializeApp({ projectId, ...(credential ? { credential } : {}) });
  const db = new Firestore({ projectId });
  const getFirestore = () => db;
  const { createDelivery } = require('../functions/delivery');
  const logger = { info: text => console.log(text), warn: text => console.warn(text), error: text => console.error(text) };
  const delivery = createDelivery({ getFirestore, FieldValue, logger, getMessaging: () => liveFcm ? getMessaging() : ({
    async sendEachForMulticast(payload) { return { responses: payload.tokens.map(() => ({ error: { code: 'QA_NO_LIVE_FCM' } })) }; },
  }) });
  const { createConnectionHandler } = require('../functions/connections');
  const { createNudgeDeletionHandler } = require('../functions/nudges');
  const connect = createConnectionHandler({ auth: getAuth, firestore: getFirestore });
  const deleteNudge = createNudgeDeletionHandler({
    auth: getAuth,
    firestore: getFirestore,
    workerUrl: `http://127.0.0.1:${port}`,
  });
  const objects = new Map();
  const bucket = {
    async put(key, body, options = {}) {
      const buffer = Buffer.from(body), httpEtag = `"${createHash('sha256').update(buffer).digest('hex')}"`;
      objects.set(key, { buffer, size: buffer.length, httpEtag, httpMetadata: options.httpMetadata || {} });
      return { size: buffer.length, httpEtag };
    },
    async head(key) { const item = objects.get(key); return item ? { ...item, body: undefined } : null; },
    async get(key, options = {}) {
      const item = objects.get(key);
      if (!item) return null;
      const range = options.range;
      const body = range?.offset !== undefined ? item.buffer.subarray(range.offset, range.offset + range.length) : item.buffer;
      return { ...item, body };
    },
    async delete(key) { objects.delete(key); },
  };
  const workerSource = fs.readFileSync(path.join(root, 'worker/index.js'), 'utf8');
  const workerExports = {};
  const code = require('@babel/core').transformSync(workerSource, {
    configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const proxyFetch = (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === 'firestore.googleapis.com') {
      if (!url.pathname.startsWith(`/v1/projects/${projectId}/`)) throw new Error('QA project mismatch.');
      url.protocol = 'http:'; url.hostname = '127.0.0.1'; url.port = String(firestorePort);
    }
    return fetch(url, options);
  };
  vm.runInNewContext(code, { exports: workerExports, Request, Response, Headers, TextEncoder, TextDecoder,
    Uint8Array, atob, URL, crypto: webcrypto, fetch: proxyFetch, console, setTimeout, clearTimeout });
  const app = express();
  app.get('/health', (_req, res) => res.json({ mode: 'local-qa', projectId, liveFcm, firestoreHost: process.env.FIRESTORE_EMULATOR_HOST,
    workerSha256: createHash('sha256').update(workerSource).digest('hex') }));
  app.all('/connectByCode', express.json({ limit: '16kb' }), connect);
  app.all('/deleteNudge', express.json({ limit: '16kb' }), deleteNudge);
  app.post('/qa/probe', express.json({ limit: '4kb' }), async (req, res) => {
    if (!liveFcm) return res.status(403).json({ error: 'Live probes are disabled.' });
    try {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
      const user = await getAuth().verifyIdToken(token || '', true);
      if (!/^qa-(sender|recipient)-[a-f0-9]+@nudgr\.example$/.test(user.email || '')) return res.status(403).end();
      const kind = req.body.kind;
      if (!['foreign', 'expired', 'duplicate'].includes(kind)) return res.status(400).end();
      let nudgeId = `qa-${kind}-${Date.now()}`, triggerEventId = 'probe', expiresAt = Date.now() + 300000;
      if (kind === 'duplicate') {
        if (!/^[A-Za-z0-9_-]{1,160}$/.test(req.body.nudgeId || '')) return res.status(400).end();
        const parent = await db.collection('nudges').doc(req.body.nudgeId).get();
        if (!parent.exists || parent.data().recipientUid !== user.uid) return res.status(403).end();
        nudgeId = parent.id; triggerEventId = parent.data().lastTriggerEventId; expiresAt = parent.data().lastTriggerExpiresAtMs;
        if (expiresAt <= Date.now() + 10000) return res.status(409).json({ error: 'Duplicate probe needs a fresh original deadline.' });
      }
      const devices = await db.collection('users').doc(user.uid).collection('devices').get();
      const tokens = [...new Set(devices.docs.filter(doc => doc.data().enabled === true).map(doc => doc.data().fcmToken).filter(Boolean))];
      if (!tokens.length || tokens.length > 500) return res.status(409).end();
      const result = await getMessaging().sendEachForMulticast({ tokens, android: { priority: 'high', ttl: 60000 }, data: {
        type: 'nudge_incoming', nudgeId, triggerEventId, senderName: 'QA boundary probe', message: 'Controlled acceptance probe',
        recipientUid: kind === 'foreign' ? 'qa-other-account' : user.uid,
        expiresAt: String(kind === 'expired' ? Date.now() - 1 : expiresAt),
      } });
      res.json({ accepted: result.successCount, failed: result.failureCount, kind, nudgeId });
    } catch (error) { res.status(503).json({ error: 'QA_PROBE_FAILED', code: error.code || 'unavailable' }); }
  });
  app.use(express.raw({ type: () => true, limit: '11mb' }), async (req, res) => {
    try {
      const request = new Request(`http://127.0.0.1:${port}${req.originalUrl}`, { method: req.method, headers: req.headers,
        ...(!['GET', 'HEAD'].includes(req.method) ? { body: req.body } : {}) });
      const response = await workerExports.default.fetch(request, { VOICE_BUCKET: bucket, FIREBASE_PROJECT_ID: projectId }, {});
      res.status(response.status);
      response.headers.forEach((value, name) => res.set(name, value));
      res.send(Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.status(503).json({ error: 'QA_REQUEST_FAILED', code: error.code || 'unavailable' }); }
  });
  const stopObserver = db.collectionGroup('triggerEvents').onSnapshot(snapshot => {
    for (const change of snapshot.docChanges()) {
      if (change.type !== 'added' || change.doc.data().status !== 'CREATED') continue;
      delivery.deliver(change.doc, { params: { nudgeId: change.doc.ref.parent.parent.id, triggerEventId: change.doc.id } })
        .catch(error => console.error(`[QA_DELIVERY_FAILED] code=${error.code || 'unknown'}`));
    }
  }, error => console.error(`[QA_OBSERVER_FAILED] code=${error.code || 'unknown'}`));
  const interval = setInterval(() => delivery.retryDue().catch(error => console.error(`[QA_RETRY_FAILED] code=${error.code || 'unknown'}`)), 60000);
  const server = app.listen(port, '127.0.0.1', () => console.log(`QA listening on loopback:${port}; Firestore loopback:${firestorePort}; live FCM=${liveFcm}`));
  const close = () => { clearInterval(interval); stopObserver(); server.close(); db.terminate().finally(() => process.exit()); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
}
main().catch(error => { console.error(`QA startup failed: ${error.code || error.message}`); process.exitCode = 1; });
