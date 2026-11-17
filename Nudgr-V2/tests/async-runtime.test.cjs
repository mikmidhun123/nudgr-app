const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

function load(file, mocks, globals = {}) {
  const module = { exports: {} };
  const source = babel.transformSync(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  vm.runInNewContext(source, { module, exports: module.exports, __DEV__: false,
    console: { log() {}, warn() {}, error() {} }, Date, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.endsWith('.mp3')) return 1;
      throw new Error(`Unmocked dependency: ${name}`);
    }, ...globals });
  return module.exports;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const player = () => {
  const calls = [];
  return { calls, playAsync: async () => calls.push('play'), stopAsync: async () => calls.push('stop'),
    unloadAsync: async () => calls.push('unload') };
};

test('Stop during a voice download prevents late playback and TTS fallback', async () => {
  const download = deferred(); let loaded = 0, spoken = 0, callbacks = 0;
  const api = load('src/voice/playback.js', {
    './audio': { Audio: { setAudioModeAsync: async () => {}, Sound: { createAsync: async () => { loaded++; } } } },
    './r2Storage': { getVoiceDownloadUrl: () => download.promise },
    './tts': { stopSpeech: async () => {}, speakNudge: async () => { spoken++; }, VOICE_STYLES: { normal: {} } },
  });
  const operation = api.playNudgeMessage({ nudge: { id: 'n1', message: 'Fallback', voiceNote: { enabled: true, storageKey: 'voice' } },
    onStart: () => callbacks++, onDone: () => callbacks++ });
  await tick(); await api.stopNudgeMessage();
  download.reject(new Error('Network failed after Stop'));
  assert.equal((await operation).cancelled, true);
  assert.equal(loaded + spoken + callbacks, 0);
});

test('Stop during audio loading unloads the late player without starting it', async () => {
  const loading = deferred(), sound = player(); let options;
  const api = load('src/voice/playback.js', {
    './audio': { Audio: { setAudioModeAsync: async () => {}, Sound: { createAsync: async (_source, opts) => {
      options = opts; return loading.promise;
    } } } },
    './r2Storage': { getVoiceDownloadUrl: async () => ({ downloadUrl: 'https://example.invalid/audio' }) },
    './tts': { stopSpeech: async () => {}, VOICE_STYLES: { normal: {} } },
  });
  const operation = api.playNudgeMessage({ nudge: { id: 'n1', voiceNote: { enabled: true, storageKey: 'voice' } } });
  await tick(); assert.equal(options.shouldPlay, false);
  await api.stopNudgeMessage(); loading.resolve({ sound });
  assert.equal((await operation).cancelled, true);
  assert.deepEqual(sound.calls, ['unload']);
});

test('a cancelled ringtone load cannot play or stop a newer ringtone', async () => {
  const old = deferred(), fresh = deferred(), first = player(), second = player(); let loads = 0;
  const api = load('src/notifications/ringtone.js', {
    'react-native': { Platform: { OS: 'android' } },
    '../voice/audio': { Audio: { setAudioModeAsync: async () => {}, Sound: {
      createAsync: () => (++loads === 1 ? old.promise : fresh.promise),
    } } },
  });
  const a = api.startRingtone(); await tick(); await api.stopRingtone();
  const b = api.startRingtone(); await tick(); fresh.resolve({ sound: second });
  assert.equal(await b, true);
  old.resolve({ sound: first }); assert.equal(await a, false);
  assert.deepEqual(first.calls, ['unload']); assert.deepEqual(second.calls, ['play']);
  assert.equal(api.isRingtonePlaying(), true);
  await api.stopRingtone(); assert.deepEqual(second.calls, ['play', 'stop', 'unload']);
});

test('cancelling a pending microphone permission never opens the recorder', async () => {
  const permission = deferred(); let created = 0;
  const api = load('src/voice/recorder.js', { './audio': { Audio: {
    getPermissionsAsync: async () => ({ status: 'undetermined' }), requestPermissionsAsync: () => permission.promise,
    Recording: class { constructor() { created++; } },
  } } });
  const recording = api.startRecording(); await tick(); await api.stopRecording();
  permission.resolve({ status: 'granted' });
  assert.equal(await recording, false); assert.equal(created, 0);
});

function nudgeApi({ read, uid = 'alice', data = {} } = {}) {
  const auth = { currentUser: { uid } }, writes = [];
  const ref = { get: read || (async () => ({ exists: () => true, id: 'n1', data: () => data })),
    update: async fields => { writes.push(fields); Object.assign(data, fields); } };
  const db = { collection: () => ({ doc: () => ref }), runTransaction: fn => fn({
    get: ref.get, update: (_ref, fields) => { writes.push(fields); Object.assign(data, fields); },
  }) };
  return { auth, writes, api: load('src/db/nudges.js', { '../firebase': {
    getAuth: () => auth, getFirestore: () => db, getServerTimestamp: () => 'server-time',
  } }) };
}

test('an account switch rejects an old cached nudge response', async () => {
  const response = deferred(), f = nudgeApi({ read: () => response.promise });
  const operation = f.api.getNudge('n1'); f.auth.currentUser = { uid: 'charlie' };
  response.resolve({ exists: () => true, id: 'n1', data: () => ({ senderUid: 'alice', recipientUid: 'bob' }) });
  assert.equal(await operation, null);
});

test('explicit re-arm preserves cooldown and a stale completion cannot disable it', async () => {
  const data = { senderUid: 'alice', recipientUid: 'bob', status: 'completed', enabled: false,
    lastTriggeredAt: 123, lastTriggerEventId: 'new-trigger' };
  const f = nudgeApi({ data }); await f.api.setNudgeEnabled('n1', true);
  assert.equal(data.status, 'active'); assert.equal(data.enabled, true);
  assert.equal(data.lastTriggeredAt, 123); assert.equal(Object.hasOwn(f.writes[0], 'lastTriggeredAt'), false);
  await f.api.markCompleted('n1', 'old-trigger');
  assert.equal(f.writes.length, 1); assert.equal(data.enabled, true);
});

test('a today pause resumes exactly at the next local midnight', async () => {
  const f = nudgeApi(); await f.api.setNudgeEnabled('n1', false, 'today');
  const paused = { status: 'active', ...f.writes[0] }, midnight = new Date(paused.disabledUntil);
  assert.equal(midnight.getHours() + midnight.getMinutes() + midnight.getSeconds() + midnight.getMilliseconds(), 0);
  assert.equal(f.api.isNudgeActive(paused, new Date(paused.disabledUntil - 1)), false);
  assert.equal(f.api.isNudgeActive(paused, midnight), true);
});

test('a recipient cannot re-arm the sender-owned arrival monitor', async () => {
  const f = nudgeApi({ uid: 'bob', data: { senderUid: 'alice', recipientUid: 'bob', status: 'completed', enabled: false } });
  await assert.rejects(f.api.setNudgeEnabled('n1', true), /Ask the sender to re-arm/);
  assert.equal(f.writes.length, 0);
});

test('offline arrivals keep their original deadline, stay account-scoped and expire without sending', async () => {
  let clock = 2000000000000, stored = null, online = false; const calls = [];
  class Clock extends Date { static now() { return clock; } }
  const auth = { currentUser: { uid: 'alice' } };
  const api = load('src/location/triggerOutbox.js', {
    '@react-native-async-storage/async-storage': { getItem: async () => stored, setItem: async (_key, value) => { stored = value; } },
    'react-native': { NativeModules: {} }, '../firebase': { getAuth: () => auth, isQaBuild: true },
    '../db/triggers': { createTriggerEvent: async (_id, data) => {
      calls.push(data); if (!online) throw Object.assign(new Error('offline'), { code: 'unavailable' });
    } },
    '../db/nudges': {}, './geoUtils': {}, '../diagnostics/runtimeStatus': { recordRuntimeStatus: async () => {} },
  }, { Date: Clock });
  await api.queueTriggerIntent({ uid: 'alice', nudgeId: 'n1', recipientUid: 'bob', coords: { latitude: 1, longitude: 2 } });
  await api.flushTriggerOutbox(); assert.equal(JSON.parse(stored).length, 1);
  auth.currentUser = { uid: 'charlie' }; await api.flushTriggerOutbox(); assert.equal(calls.length, 1);
  auth.currentUser = { uid: 'alice' }; online = true; clock += 299999;
  await api.flushTriggerOutbox(); assert.equal(calls[1].observedAtMs, 2000000000000);
  assert.equal(JSON.parse(stored).length, 0);
  await api.queueTriggerIntent({ uid: 'alice', nudgeId: 'n2', recipientUid: 'bob', coords: { latitude: 1, longitude: 2 } });
  clock += 300000; await api.flushTriggerOutbox();
  assert.equal(calls.length, 2); assert.equal(JSON.parse(stored).length, 0);
});

test('SDK 25 missing snapshots allow signup to create an invitation and complete a token-only profile', async () => {
  const rows = new Map([['users/alice', { uid: 'alice', fcmTokens: { private: true } }]]);
  const api = load('src/db/users.js', {
    '../firebase': { getServerTimestamp: () => 'server-time', getFirestore: () => ({
      collection: collection => ({ doc: id => ({
        get: async () => ({ exists: () => rows.has(`${collection}/${id}`), data: () => rows.get(`${collection}/${id}`) }),
        set: async (fields, options) => rows.set(`${collection}/${id}`, { ...(options?.merge ? rows.get(`${collection}/${id}`) : {}), ...fields }),
      }) }),
    }) }, './codes': { generateConnectionCode: () => 'ABCD2345' },
  });
  const profile = await api.ensureUserProfile({ uid: 'alice', email: 'fixture@example.invalid', displayName: 'Alice' });
  assert.equal(profile.connectionCode, 'ABCD2345'); assert.equal(profile.connectionCodeVersion, 2);
  assert.equal(profile.displayName, 'Alice'); assert.equal(rows.get('connectionCodes/ABCD2345').uid, 'alice');
  assert.equal(rows.get('profiles/alice').fcmTokens, undefined);
});
