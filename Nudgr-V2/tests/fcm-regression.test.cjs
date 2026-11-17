const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const babel = require('@babel/core');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {} };
const incomingPolicy = {};
vm.runInNewContext(require('typescript').transpileModule(fs.readFileSync(path.join(root, 'src/runtime/incoming.ts'), 'utf8'),
  { compilerOptions: { module: require('typescript').ModuleKind.CommonJS } }).outputText, { exports: incomingPolicy });

function backend({ tokens = { testToken: true }, result, sendError, cleanupError } = {}) {
  const event = { status: 'CREATED', nudgeId: 'nudge1', senderUid: 'sender', recipientUid: 'recipient' };
  const writes = [];
  const payloads = [];
  const logs = [];
  const ref = { async update(update) { writes.push(update); Object.assign(event, update); } };
  const nudge = { senderName: 'Alice', senderUid: 'sender', recipientUid: 'recipient', message: 'Hello', status: 'triggered' };
  let serial = Promise.resolve();
  const firestore = {
    collection(collection) {
      return { doc() { return {
        async get() { return { exists: true, data: () => collection === 'nudges' ? nudge : collection === 'connections'
          ? { users: ['recipient', 'sender'], status: 'connected', verification: 'invitation-code' } : { fcmTokens: tokens } }; },
        async update() { if (cleanupError) throw cleanupError; },
        collection() { return { get: async () => ({ docs: [] }) }; },
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
    firestore: { document: () => ({ onCreate: callback => callback, onWrite: callback => callback }) },
    https: { onRequest: callback => callback },
    pubsub: { schedule: () => ({ onRun: callback => callback }) },
    logger: Object.fromEntries(['info', 'warn', 'error'].map(level => [level, text => logs.push(text)])),
  };
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8'), {
    exports, require(name) {
      if (name === 'firebase-admin/app') return { initializeApp: admin.initializeApp };
      if (name === 'firebase-admin/firestore') return { getFirestore: admin.firestore, FieldValue: admin.firestore.FieldValue };
      if (name === 'firebase-admin/messaging') return { getMessaging: admin.messaging };
      if (name === './delivery') return require('../functions/delivery');
      return functions;
    },
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
    expiresAt: String(fixture.event.expiresAtMs),
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
  assert.equal(message.android.notification.visibility, 'PRIVATE');
  assert.equal(fixture.event.status, 'FCM_SENT');
  assert.equal(fixture.event.fcmSuccessCount, 1);
  assert.ok(fixture.logs.every(log => !log.includes('testToken')));
});

test('backend loads with the installed Admin SDK modular exports', () => {
  const { createRequire } = require('node:module');
  const fromFunctions = createRequire(path.join(root, 'functions/index.js'));
  assert.equal(typeof fromFunctions('firebase-admin/app').initializeApp, 'function');
  assert.equal(typeof fromFunctions('firebase-admin/firestore').getFirestore, 'function');
  assert.equal(typeof fromFunctions('firebase-admin/messaging').getMessaging, 'function');
  const source = fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8');
  const exports = {};
  vm.runInNewContext(source, { exports, require: fromFunctions });
  assert.equal(typeof exports.sendNudgeOnTrigger, 'function');
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

function notificationsFixture({ permissionError = false, incomingState = null, nativeActive = false, nativeHandled = null, appState = 'active' } = {}) {
  const requests = [];
  const categories = [];
  const channels = [];
  const dismissed = [];
  const store = new Map();
  let permissionRequests = 0;
  const nativePosts = [];
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
    if (name === 'react-native') return { Platform: { OS: 'android' }, AppState: { currentState: appState } };
    if (name === './incomingState') return { getIncomingState: async () => incomingState, INCOMING_STATES: { RINGING: 'ringing' } };
    if (name === './nativeNotificationBridge') return {
      dismissNativeNotification: async () => {},
      isNativeNotificationActive: async () => nativeActive,
      showNativeIncomingNotification: async params => { nativePosts.push(params); return nativeHandled; },
    };
    return { __esModule: true, default: storage };
  } });
  return { exports, requests, categories, channels, dismissed, store, nativePosts, permissionRequests: () => permissionRequests };
}

test('legacy Expo fallback uses the call channel/actions and deduplicates', async () => {
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

test('background Firestore notification uses the native poster and never replaces its actions with Expo', async () => {
  const fixture = notificationsFixture({ appState: 'background', nativeHandled: true });
  const id = await fixture.exports.showIncomingNudgeNotification({ nudgeId: 'nudge1', triggerId: 'trigger1' });
  assert.equal(id, 'nudgr_nudge1');
  assert.equal(fixture.nativePosts.length, 1);
  assert.equal(fixture.nativePosts[0].triggerId, 'trigger1');
  assert.equal(fixture.requests.length, 0);
});

test('foreground Firestore cannot overwrite an active native call notification', async () => {
  const fixture = notificationsFixture({ nativeActive: true });
  assert.equal(await fixture.exports.showIncomingNudgeNotification({ nudgeId: 'nudge1' }), 'nudgr_nudge1');
  assert.equal(fixture.requests.length, 0);
});

test('a durable cold Decline suppresses Firestore notification replay after process restart', async () => {
  const fixture = notificationsFixture({ incomingState: { nudgeId: 'nudge1', state: 'declined' }, appState: 'background', nativeHandled: true });
  assert.equal(await fixture.exports.showIncomingNudgeNotification({ nudgeId: 'nudge1' }), null);
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.nativePosts.length, 0);
});

test('per-Nudgr cold Decline is retained even when another Nudgr is the current JS state', async () => {
  const source = babel.transformSync(fs.readFileSync(path.join(root, 'src/notifications/incomingState.js'), 'utf8'), {
    configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const exports = {};
  vm.runInNewContext(source, { exports, console: quiet, __DEV__: false, require(name) {
    if (name === './nativeNotificationBridge') return {
      getNativeIncomingState: async id => ({ nudgeId: id, recipientUid: 'recipient', state: 'declined', timestamp: 1 }),
    };
    if (name === '../firebase') return { getAuth: () => ({ currentUser: { uid: 'recipient' } }) };
    return { __esModule: true, default: { getItem: async () => JSON.stringify({ nudgeId: 'another', state: 'ringing', timestamp: Date.now() }) } };
  } });
  const state = await exports.getIncomingState('declined-nudge');
  assert.equal(state.nudgeId, 'declined-nudge');
  assert.equal(state.state, 'declined');
});

test('module-scope headless callback uses the native poster with the trigger ID', async () => {
  const source = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const registration = ast.program.body.find(node => node.type === 'ExpressionStatement'
    && node.expression.callee?.property?.name === 'setBackgroundMessageHandler');
  let callback;
  const posted = [];
  vm.runInNewContext(source.slice(registration.start, registration.end), {
    parseIncoming: incomingPolicy.parseIncoming,
    getAuth: () => ({ currentUser: { uid: 'recipient' } }),
    messaging: () => ({ setBackgroundMessageHandler: handler => { callback = handler; } }),
    showNativeIncomingNotification: async params => { posted.push(params); return true; },
    showIncomingNudgeNotification: async () => { throw new Error('Expo must not replace native posting'); },
    recordRuntimeStatus: async () => {}, console: quiet,
  });
  await callback({ sentTime: Date.now(), notification: { title: 'Nudgr' }, data: { recipientUid: 'recipient', nudgeId: 'nudge1', triggerEventId: 'trigger1', senderName: 'Alice', message: 'Hello' } });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].triggerId, 'trigger1');
});

test('token registration and refresh serialize to the nested map read by the backend', async () => {
  const { Firestore } = require('../functions/node_modules/@google-cloud/firestore');
  const firestore = new Firestore({ projectId: 'offline-test' });
  const writes = [];
  const privateWrites = [];
  let refresh;
  const ref = { collection: () => ({ doc: () => ({ set: async data => privateWrites.push(data) }) }), async set(data, options) {
    assert.equal(options.merge, true);
    writes.push(firestore._serializer.encodeFields(data));
  } };
  const source = babel.transformSync(fs.readFileSync(path.join(root, 'src/fcm/tokens.js'), 'utf8'), {
    configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const exports = {};
  const storage = new Map();
  vm.runInNewContext(source, { exports, console: quiet, __DEV__: false, require(name) {
    if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: {
      getItem: async key => storage.get(key), setItem: async (key, value) => storage.set(key, value),
    } };
    if (name === 'react-native') return { Platform: { OS: 'android' } };
    return {
    getAuth: () => ({ currentUser: { uid: 'recipient' } }),
    getMessaging: () => ({ getToken: async () => 'initial-token', onTokenRefresh: callback => { refresh = callback; } }),
    getFirestore: () => ({ collection: () => ({ doc: () => ref }) }),
    getServerTimestamp: () => 1,
   }; } });
  await exports.syncFcmToken({ uid: 'recipient' });
  exports.attachFcmTokenRefresh();
  await refresh('rotated-token');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].fcmTokens.mapValue.fields['initial-token'].booleanValue, true);
  assert.equal(writes[1].fcmTokens.mapValue.fields['rotated-token'].booleanValue, true);
  assert.ok(writes.every(write => !Object.keys(write).some(key => key.startsWith('fcmTokens.'))));
  assert.equal(privateWrites.length, 2);
  assert.equal(privateWrites[0].fcmToken, 'initial-token');
  assert.equal(privateWrites[1].fcmToken, 'rotated-token');
  assert.equal(privateWrites[0].deviceId, privateWrites[1].deviceId);
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
    parseIncoming: incomingPolicy.parseIncoming,
    getAuth: () => ({ currentUser: { uid: 'recipient' } }),
    messaging: () => ({ setBackgroundMessageHandler: handler => { callback = handler; } }),
    showIncomingNudgeNotification: fixture.exports.showIncomingNudgeNotification,
    recordRuntimeStatus: async () => {}, console: quiet,
  });
  await callback({ sentTime: Date.now(), notification: { title: '📍 Nudgr' }, data: { recipientUid: 'recipient', triggerEventId: 't1', nudgeId: 'nudge1', senderName: 'Alice' } });
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

test('cold native OPEN through Expo preserves ringing until the incoming UI is ready', () => {
  const source = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let handler;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id.name === 'handleNotificationResponse') handler = node;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  const opened = [], answered = [];
  const context = {
    console: quiet,
    showIncoming: id => opened.push(id),
    handleAnswerAction: id => answered.push(id),
    dismissIncoming: () => { throw new Error('Cold OPEN must preserve native ringing'); },
    navigate: () => { throw new Error('Native call OPEN must use the incoming UI'); },
  };
  vm.createContext(context);
  vm.runInContext(`const ${source.slice(handler.start, handler.end)}; globalThis.handle = handleNotificationResponse;`, context);
  const response = action => ({ actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: { request: { content: { data: { nudgeId: 'cold-call', action, startAnswered: action === 'ANSWER' } } } } });
  context.handle(response('OPEN'));
  context.handle(response('ANSWER'));
  assert.deepEqual(opened, ['cold-call']);
  assert.deepEqual(answered, ['cold-call']);
});

test('Android ringtone can start and preload without the missing Expo filesystem module', async () => {
  const source = babel.transformSync(fs.readFileSync(path.join(root, 'src/notifications/ringtone.js'), 'utf8'), {
    configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const exports = {};
  let loads = 0, stops = 0, unloads = 0;
  vm.runInNewContext(source, { exports, console: quiet, __DEV__: false, require(name) {
    if (name === 'react-native') return { Platform: { OS: 'android' } };
    if (name === '../voice/audio') return { Audio: {
      setAudioModeAsync: async () => {},
      Sound: { async createAsync(asset, status, callback, downloadFirst = true) {
        if (downloadFirst) throw new Error("ExpoAsset.downloadAsync: AppDirectories module not found");
        loads++;
        return { sound: { playAsync: async () => {}, stopAsync: async () => { stops++; }, unloadAsync: async () => { unloads++; } } };
      } },
    } };
    return 123; // Metro's bundled raw-resource reference.
  } });
  assert.equal(await exports.startRingtone(), true);
  assert.equal(exports.isRingtonePlaying(), true);
  await exports.stopRingtone();
  assert.equal(exports.isRingtonePlaying(), false);
  await exports.preloadRingtone();
  assert.equal(loads, 2);
  assert.equal(stops, 1);
  assert.equal(unloads, 2);
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
