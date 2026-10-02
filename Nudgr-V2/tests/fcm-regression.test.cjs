const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const babel = require('@babel/core');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {} };

function backend({ tokens = { testToken: true }, result, sendError, cleanupError } = {}) {
  const event = { status: 'CREATED' };
  const writes = [];
  const payloads = [];
  const logs = [];
  const ref = { async update(update) { writes.push(update); Object.assign(event, update); } };
  const nudge = { senderName: 'Alice', senderUid: 'sender', recipientUid: 'recipient', message: 'Hello' };
  let serial = Promise.resolve();
  const firestore = {
    collection(collection) {
      return { doc() { return {
        async get() { return { exists: true, data: () => collection === 'nudges' ? nudge : { fcmTokens: tokens } }; },
        async update() { if (cleanupError) throw cleanupError; },
      }; } };
    },
    runTransaction(callback) {
      const operation = serial.then(() => callback({
        async get() { return { exists: true, data: () => ({ ...event }) }; },
        update(_ref, update) { Object.assign(event, update); writes.push(update); },
      }));
      serial = operation.catch(() => {});
      return operation;
    },
  };
  const admin = {
    initializeApp() {},
    firestore: Object.assign(() => firestore, { FieldValue: { serverTimestamp: () => 'timestamp', delete: () => 'deleted' } }),
    messaging: () => ({ async sendEachForMulticast(payload) {
      assert.equal(event.status, 'FCM_SENDING');
      assert.equal(event.fcmSentAt, undefined);
      payloads.push(payload);
      if (sendError) throw sendError;
      return result || { successCount: 1, failureCount: 0, responses: [{ success: true }] };
    } }),
  };
  const functions = {
    firestore: { document: () => ({ onCreate: callback => callback }) },
    https: { onRequest: callback => callback },
    logger: Object.fromEntries(['info', 'warn', 'error'].map(level => [level, text => logs.push(text)])),
  };
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8'), {
    exports, require: name => name === 'firebase-admin' ? admin : functions,
  });
  const run = () => exports.sendNudgeOnTrigger({ data: () => ({ status: 'CREATED' }), ref }, {
    params: { nudgeId: 'nudge1', triggerEventId: 'trigger1' },
  });
  return { run, event, writes, payloads, logs };
}

test('notification + data uses the installed Admin SDK schema and marks acceptance after send', async () => {
  const fixture = backend();
  await fixture.run();
  const payload = JSON.parse(JSON.stringify(fixture.payloads[0]));
  assert.deepEqual(payload.notification, { title: '📍 Nudgr', body: 'Alice sent you a Nudgr' });
  assert.deepEqual(payload.data, {
    nudgeId: 'nudge1', triggerEventId: 'trigger1', type: 'nudge_incoming',
    senderUid: 'sender', recipientUid: 'recipient', senderName: 'Alice', message: 'Hello',
  });
  assert.equal(payload.android.priority, 'high');
  assert.equal(payload.android.notification.channelId, 'nudgr_calls_v3');
  assert.equal(payload.android.notification.tag, 'nudgr_nudge1');
  assert.equal(payload.android.notification.sound, 'ringtone');
  assert.equal(payload.android.notification.defaultSound, false);
  assert.equal(payload.android.notification.defaultVibrateTimings, false);
  const { validateMessage } = require('../functions/node_modules/firebase-admin/lib/messaging/messaging-internal.js');
  const { tokens, ...message } = payload;
  validateMessage({ ...message, token: tokens[0] });
  assert.equal(message.android.notification.notification_priority, 'PRIORITY_MAX');
  assert.equal(message.android.notification.visibility, 'PUBLIC');
  assert.equal(fixture.event.status, 'FCM_SENT');
  assert.equal(fixture.event.fcmSuccessCount, 1);
  assert.ok(fixture.logs.every(log => !log.includes('testToken')));
});

test('missing tokens record failure without sending', async () => {
  const fixture = backend({ tokens: {} });
  await fixture.run();
  assert.equal(fixture.payloads.length, 0);
  assert.equal(fixture.event.status, 'FCM_FAILED');
  assert.equal(fixture.event.error, 'RECIPIENT_TOKEN_MISSING');
});

test('all rejected tokens and thrown sends never report FCM_SENT', async () => {
  for (const options of [
    { result: { successCount: 0, failureCount: 1, responses: [{ success: false, error: { code: 'messaging/registration-token-not-registered' } }] } },
    { sendError: Object.assign(new Error('Sensitive token must not appear in logs'), { code: 'messaging/unavailable' }) },
  ]) {
    const fixture = backend(options);
    await fixture.run();
    assert.equal(fixture.event.status, 'FCM_FAILED');
    assert.equal(fixture.event.fcmSentAt, undefined);
    assert.ok(!fixture.logs.some(log => log.includes('[FCM_SEND_SUCCESS]')));
    assert.ok(!fixture.logs.some(log => log.includes('Sensitive token')));
  }
});

test('partial acceptance survives failed token cleanup', async () => {
  const fixture = backend({
    tokens: { good: true, expired: true }, cleanupError: new Error('cleanup unavailable'),
    result: { successCount: 1, failureCount: 1, responses: [{ success: true }, { success: false, error: { code: 'messaging/registration-token-not-registered' } }] },
  });
  await fixture.run();
  assert.equal(fixture.event.status, 'FCM_SENT');
  assert.equal(fixture.event.fcmFailureCount, 1);
  assert.ok(fixture.logs.some(log => log.includes('FCM_TOKEN_CLEANUP_FAILED')));
});

test('concurrent or repeated onCreate snapshots send only once', async () => {
  const fixture = backend();
  await Promise.all([fixture.run(), fixture.run()]);
  await fixture.run();
  assert.equal(fixture.payloads.length, 1);
});

function notificationsFixture({ permissionError = false } = {}) {
  const requests = [];
  const categories = [];
  const channels = [];
  const dismissed = [];
  const store = new Map();
  let permissionRequests = 0;
  const notifications = {
    setNotificationHandler() {},
    async getPermissionsAsync() {
      if (permissionError) throw new Error('Permission getter unavailable in headless runtime');
      return { granted: true, status: 'granted' };
    },
    async requestPermissionsAsync() { permissionRequests++; throw new Error('Interactive permission in headless code'); },
    async setNotificationChannelAsync(id, settings) { channels.push({ id, settings }); },
    async getNotificationChannelsAsync() { return channels; },
    async setNotificationCategoryAsync(id, actions) { categories.push({ id, actions }); },
    async scheduleNotificationAsync(request) { requests.push(request); return request.identifier; },
    async dismissNotificationAsync(id) { dismissed.push(id); },
    AndroidImportance: { MAX: 5, HIGH: 4 },
    AndroidNotificationVisibility: { PUBLIC: 1 },
    AndroidNotificationPriority: { MAX: 'max' },
  };
  const storage = {
    getItem: async key => store.get(key) || null,
    setItem: async (key, value) => store.set(key, value),
    removeItem: async key => store.delete(key),
  };
  const source = babel.transformSync(fs.readFileSync(path.join(root, 'src/notifications/localNotifications.js'), 'utf8'), {
    configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const exports = {};
  vm.runInNewContext(source, { exports, console: quiet, __DEV__: false, require(name) {
    if (name === 'expo-notifications') return notifications;
    if (name === 'react-native') return { Platform: { OS: 'android' } };
    return { __esModule: true, default: storage };
  } });
  return { exports, requests, categories, channels, dismissed, store, permissionRequests: () => permissionRequests };
}

test('headless local enhancement matches the native slot, uses call channel/actions, and deduplicates', async () => {
  const fixture = notificationsFixture();
  const params = { nudgeId: 'nudge1', senderName: 'Alice', message: 'Hello' };
  await Promise.all([fixture.exports.showIncomingNudgeNotification(params), fixture.exports.showIncomingNudgeNotification(params)]);
  await fixture.exports.showIncomingNudgeNotification(params);
  assert.equal(fixture.requests.length, 1);
  const request = fixture.requests[0];
  assert.equal(request.identifier, 'nudgr_nudge1');
  assert.equal(request.trigger.channelId, 'nudgr_calls_v3');
  assert.equal(request.content.sound, 'ringtone.mp3');
  assert.equal(request.content.categoryIdentifier, 'nudgr_incoming');
  const callChannel = fixture.channels.find(channel => channel.id === 'nudgr_calls_v3');
  assert.equal(callChannel.settings.importance, 5);
  assert.equal(callChannel.settings.lockscreenVisibility, 1);
  assert.deepEqual(Array.from(callChannel.settings.vibrationPattern), [0, 800, 200, 800]);
  assert.deepEqual(Array.from(fixture.categories[0].actions, action => action.identifier), ['ANSWER', 'DECLINE']);
  assert.equal(fixture.permissionRequests(), 0);
  await fixture.exports.dismissIncomingNudgeNotification('nudge1');
  assert.deepEqual(fixture.dismissed, ['nudgr_nudge1']);
  assert.equal(fixture.store.size, 0);
});

test('actual module-scope background callback handles notification + data without interactive permissions', async () => {
  const fixture = notificationsFixture();
  const source = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const registration = ast.program.body.find(node => node.type === 'ExpressionStatement'
    && node.expression.callee?.property?.name === 'setBackgroundMessageHandler');
  assert.ok(registration, 'Background handler must stay registered at module scope');
  let callback;
  vm.runInNewContext(source.slice(registration.start, registration.end), {
    Platform: { OS: 'android' },
    messaging: () => ({ setBackgroundMessageHandler: handler => { callback = handler; } }),
    showIncomingNudgeNotification: fixture.exports.showIncomingNudgeNotification,
    recordRuntimeStatus: async () => {}, console: quiet,
  });
  await callback({ notification: { title: '📍 Nudgr' }, data: { nudgeId: 'nudge1', senderName: 'Alice' } });
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].identifier, 'nudgr_nudge1');
  assert.equal(fixture.permissionRequests(), 0);
});

test('background notification + data restores actions when a Firestore notification marker already exists', async () => {
  const fixture = notificationsFixture();
  await fixture.exports.showIncomingNudgeNotification({ nudgeId: 'nudge1' });
  await fixture.exports.showIncomingNudgeNotification({ nudgeId: 'nudge1', replaceNativeNotification: true });
  assert.equal(fixture.requests.length, 2);
  assert.ok(fixture.requests.every(request => request.identifier === 'nudgr_nudge1'));
  assert.ok(fixture.requests.every(request => request.content.categoryIdentifier === 'nudgr_incoming'));
  assert.equal(fixture.permissionRequests(), 0);
});

test('dismissal cancels the native fallback even without a saved local marker', async () => {
  const fixture = notificationsFixture();
  await fixture.exports.dismissIncomingNudgeNotification('nudge1');
  assert.deepEqual(fixture.dismissed, ['nudgr_nudge1']);
});

test('a failed headless permission getter still displays without requesting permission', async () => {
  const fixture = notificationsFixture({ permissionError: true });
  await fixture.exports.showIncomingNudgeNotification({ nudgeId: 'nudge1' });
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.permissionRequests(), 0);
});

test('foreground FCM keeps the existing local notification callback', async () => {
  let onMessage;
  const received = [];
  const messaging = {
    onMessage(callback) { onMessage = callback; return () => {}; },
    onNotificationOpenedApp() { return () => {}; },
    getInitialNotification: async () => null,
  };
  const source = babel.transformSync(fs.readFileSync(path.join(root, 'src/fcm/delivery.js'), 'utf8'), {
    configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const exports = {};
  vm.runInNewContext(source, { exports, console: quiet, require: () => ({ getMessaging: () => messaging }) });
  exports.attachFcmListeners({ onNudgeMessage: (id, info) => received.push({ id, info }) });
  onMessage({ notification: { title: '📍 Nudgr' }, data: { type: 'nudge_incoming', nudgeId: 'nudge1', senderName: 'Alice' } });
  assert.equal(received.length, 1);
  assert.equal(received[0].id, 'nudge1');
  assert.equal(received[0].info.senderName, 'Alice');
});

test('all app JavaScript parses, including JSX and background registration', () => {
  const files = ['App.js', 'index.js'];
  function collect(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(relative);
      else if (entry.name.endsWith('.js')) files.push(relative);
    }
  }
  collect('src');
  for (const file of files) parser.parse(fs.readFileSync(path.join(root, file), 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
});
