const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {} };

function loadJs(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const code = babel.transformSync(fs.readFileSync(path.join(root, file), 'utf8'), {
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    __DEV__: false,
    console: quiet,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Promise,
    JSON,
    setTimeout,
    clearTimeout,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`Unmocked dependency in ${file}: ${name}`);
    },
    ...globals,
  });
  return module.exports;
}

function loadTsRuntime(name) {
  const exports = {};
  const output = ts.transpileModule(
    fs.readFileSync(path.join(root, `src/runtime/${name}.ts`), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText;
  vm.runInNewContext(output, {
    exports,
    Promise,
    Date,
    Math,
    Number,
    Array,
    require: (dep) => loadTsRuntime(dep.replace('./', '')),
  });
  return exports;
}

const geo = loadJs('src/location/geoUtils.js');
const { nextSenderWakeup } = loadTsRuntime('scheduling');

test('scheduleAllows enforces weekdays, same-day time windows, overnight windows, and expiry', () => {
  // Monday 2026-11-16 (day=1)
  const mon10am = new Date(2026, 10, 16, 10, 0, 0);
  const mon8am = new Date(2026, 10, 16, 8, 0, 0);
  const sat10am = new Date(2026, 10, 21, 10, 0, 0);

  const weekdayOffice = {
    schedule: {
      daysOfWeek: [1, 2, 3, 4, 5],
      startHour: 9,
      startMinute: 0,
      endHour: 18,
      endMinute: 0,
    },
  };

  assert.equal(geo.scheduleAllows(weekdayOffice, mon10am), true);
  assert.equal(geo.scheduleAllows(weekdayOffice, mon8am), false);
  assert.equal(geo.scheduleAllows(weekdayOffice, sat10am), false);

  // Overnight window: Monday night 22:00 -> Tuesday morning 06:00 (daysOfWeek: [1] = Monday)
  const overnightMonday = {
    schedule: {
      daysOfWeek: [1],
      startHour: 22,
      startMinute: 0,
      endHour: 6,
      endMinute: 0,
    },
  };
  const mon11pm = new Date(2026, 10, 16, 23, 0, 0); // Monday 23:00
  const tue2am = new Date(2026, 10, 17, 2, 0, 0);   // Tuesday 02:00 (spillover from Monday night)
  const tue7am = new Date(2026, 10, 17, 7, 0, 0);   // Tuesday 07:00 (outside window)
  const wed2am = new Date(2026, 10, 18, 2, 0, 0);   // Wednesday 02:00 (spillover from Tuesday, not in daysOfWeek)

  assert.equal(geo.scheduleAllows(overnightMonday, mon11pm), true);
  assert.equal(geo.scheduleAllows(overnightMonday, tue2am), true);
  assert.equal(geo.scheduleAllows(overnightMonday, tue7am), false);
  assert.equal(geo.scheduleAllows(overnightMonday, wed2am), false);

  // Expiration check
  const expiredNudge = { schedule: { expiresAt: mon10am.getTime() - 1000 } };
  assert.equal(geo.scheduleAllows(expiredNudge, mon10am), false);
});

test('canTriggerByRepeatPolicy handles once, once_per_day, and multiple_per_day with exit hysteresis', () => {
  const day1 = new Date(2026, 10, 16, 12, 0, 0);
  const day1Later = new Date(2026, 10, 16, 18, 0, 0);
  const day2Morning = new Date(2026, 10, 17, 8, 0, 0);
  const day1Key = geo.localDateKey(day1);

  // 1. ONCE
  assert.equal(geo.canTriggerByRepeatPolicy({ status: 'active', repeatMode: 'once' }, day1), true);
  assert.equal(geo.canTriggerByRepeatPolicy({ status: 'triggered', repeatMode: 'once' }, day1Later), false);
  assert.equal(geo.canTriggerByRepeatPolicy({ status: 'completed', repeatMode: 'once' }, day2Morning), false);

  // 2. ONCE_PER_DAY
  const dailyUntriggered = { status: 'active', repeatMode: 'once_per_day', lastTriggeredDate: null };
  assert.equal(geo.canTriggerByRepeatPolicy(dailyUntriggered, day1), true);

  const dailyTriggeredToday = {
    status: 'active',
    repeatMode: 'once_per_day',
    lastTriggeredDate: day1Key,
    lastTriggeredAt: day1.getTime(),
  };
  assert.equal(geo.canTriggerByRepeatPolicy(dailyTriggeredToday, day1Later), false);
  assert.equal(geo.canTriggerByRepeatPolicy(dailyTriggeredToday, day2Morning), true);

  // 3. MULTIPLE_PER_DAY with exit hysteresis & custom cooldown
  const multiNudge = {
    status: 'active',
    repeatMode: 'multiple_per_day',
    cooldownMinutes: 60,
    requireExitBeforeRetrigger: true,
    lastTriggeredAt: day1.getTime(),
  };
  const after30Min = new Date(day1.getTime() + 30 * 60 * 1000);
  const after65Min = new Date(day1.getTime() + 65 * 60 * 1000);

  // Still on cooldown even if exited
  assert.equal(geo.canTriggerByRepeatPolicy(multiNudge, after30Min, false), false);
  // Cooldown passed, but user never exited the zone -> blocked!
  assert.equal(geo.canTriggerByRepeatPolicy(multiNudge, after65Min, true), false);
  // Cooldown passed AND user exited the zone -> allowed!
  assert.equal(geo.canTriggerByRepeatPolicy(multiNudge, after65Min, false), true);
});

test('hasExitedRadiusWithHysteresis requires clearing radius plus 200m buffer', () => {
  const nudge = {
    triggerLatitude: 12.9716,
    triggerLongitude: 77.5946,
    radiusKm: 2.5, // 2500m
  };
  // At center (0m) -> not exited
  assert.equal(geo.hasExitedRadiusWithHysteresis(nudge, { latitude: 12.9716, longitude: 77.5946, accuracy: 20 }), false);
  // ~2600m north (~0.0234 deg lat) -> within 2500m + 200m hysteresis -> not exited
  assert.equal(geo.hasExitedRadiusWithHysteresis(nudge, { latitude: 12.9716 + 0.0234, longitude: 77.5946, accuracy: 20 }), false);
  // ~3000m north (~0.027 deg lat) -> beyond 2700m -> exited!
  assert.equal(geo.hasExitedRadiusWithHysteresis(nudge, { latitude: 12.9716 + 0.0275, longitude: 77.5946, accuracy: 20 }), true);
});

test('nextSenderWakeup schedules next midnight for once_per_day and custom cooldown for multiple_per_day', () => {
  const now = new Date(2026, 10, 16, 14, 0, 0).getTime();
  const todayStr = geo.localDateKey(new Date(now));
  const expectedMidnight = new Date(now);
  expectedMidnight.setHours(24, 0, 0, 0);

  const wakeDaily = nextSenderWakeup(
    [{ status: 'active', enabled: true, repeatMode: 'once_per_day', lastTriggeredDate: todayStr, lastTriggeredAt: now - 60000 }],
    now
  );
  assert.equal(wakeDaily, expectedMidnight.getTime());

  const wakeMulti = nextSenderWakeup(
    [{ status: 'active', enabled: true, repeatMode: 'multiple_per_day', cooldownMinutes: 45, lastTriggeredAt: now - 15 * 60000 }],
    now
  );
  assert.equal(wakeMulti, now + 30 * 60000);
});

test('markCompleted preserves active state on repeating nudges and recipientHidden resets when sender turns ON', async () => {
  const store = new Map([
    ['onceNudge', { senderUid: 'alice', recipientUid: 'bob', status: 'triggered', enabled: true, repeatMode: 'once', lastTriggerEventId: 't1' }],
    ['dailyNudge', { senderUid: 'alice', recipientUid: 'bob', status: 'active', enabled: true, repeatMode: 'once_per_day', lastTriggerEventId: 't2', recipientHidden: true }],
  ]);
  let currentUid = 'bob';

  const db = {
    collection: () => ({
      doc: (id) => ({
        get: async () => ({ exists: () => store.has(id), id, data: () => ({ ...store.get(id) }) }),
        update: async (fields) => {
          store.set(id, { ...store.get(id), ...fields });
        },
      }),
    }),
    runTransaction: async (fn) =>
      fn({
        get: async (ref) => ref.get(),
        update: (ref, fields) => ref.update(fields),
      }),
  };

  const nudges = loadJs('src/db/nudges.js', {
    '../firebase': {
      getAuth: () => ({ currentUser: { uid: currentUid } }),
      getFirestore: () => db,
      getServerTimestamp: () => 'ts',
    },
  });

  // Recipient finishes playback on a 'once' nudge -> marks completed & disabled
  await nudges.markCompleted('onceNudge', 't1');
  assert.equal(store.get('onceNudge').status, 'completed');
  assert.equal(store.get('onceNudge').enabled, false);

  // Recipient finishes playback on a 'once_per_day' nudge -> remains active & enabled!
  await nudges.markCompleted('dailyNudge', 't2');
  assert.equal(store.get('dailyNudge').status, 'active');
  assert.equal(store.get('dailyNudge').enabled, true);

  // Recipient hides 'onceNudge'
  await nudges.hideReceivedNudge('onceNudge');
  assert.equal(store.get('onceNudge').recipientHidden, true);

  // Sender turns 'onceNudge' back ON -> recipientHidden automatically resets to false!
  currentUid = 'alice';
  await nudges.setNudgeEnabled('onceNudge', true);
  assert.equal(store.get('onceNudge').enabled, true);
  assert.equal(store.get('onceNudge').status, 'active');
  assert.equal(store.get('onceNudge').recipientHidden, false);
});

test('evaluateSenderNudges enforces exit hysteresis on multiple_per_day and posts sender notification only on created triggers', async () => {
  const storage = new Map();
  let triggerCount = 0;
  const senderNotifications = [];
  const nudgeDoc = {
    id: 'n-multi',
    senderUid: 'alice',
    recipientUid: 'bob',
    recipientName: 'Bob',
    title: 'Gym Arrival',
    triggerLabel: 'Fitness First',
    message: 'At the gym!',
    triggerLatitude: 12.9716,
    triggerLongitude: 77.5946,
    radiusKm: 2.5,
    status: 'active',
    enabled: true,
    repeatMode: 'multiple_per_day',
    cooldownMinutes: 15,
    requireExitBeforeRetrigger: true,
    lastTriggeredAt: null,
  };

  const bg = loadJs('src/location/backgroundGeofence.js', {
    'react-native': { NativeModules: {} },
    './triggerOutbox': { queueTriggerIntent: async () => {}, isTransientTriggerError: () => false },
    'expo-task-manager': { defineTask: () => {}, isTaskDefined: () => true, isTaskRegisteredAsync: async () => true },
    'expo-location': { GeofencingEventType: { Enter: 1, Exit: 2 } },
    '@react-native-async-storage/async-storage': {
      getItem: async (k) => storage.get(k) || null,
      setItem: async (k, v) => storage.set(k, v),
      removeItem: async (k) => storage.delete(k),
    },
    '@react-native-firebase/app': {
      firebase: {
        apps: [{}],
        auth: () => ({ currentUser: { uid: 'alice' } }),
        firestore: () => ({
          collection: () => ({
            where: () => ({
              get: async () => ({ docs: [{ id: nudgeDoc.id, data: () => ({ ...nudgeDoc }) }] }),
            }),
          }),
        }),
      },
    },
    '@react-native-firebase/firestore': { FieldValue: { serverTimestamp: () => 'ts' } },
    '@react-native-firebase/auth': {},
    '../db/nudges': loadJs('src/db/nudges.js', {
      '../firebase': {
        getAuth: () => ({ currentUser: { uid: 'alice' } }),
        getFirestore: () => ({}),
        getServerTimestamp: () => 'ts',
      },
    }),
    './geoUtils': geo,
    '../db/triggers': {
      createTriggerEvent: async (id) => {
        triggerCount++;
        return { id: `trig_${triggerCount}`, created: true, cooldown: false };
      },
    },
    '../notifications/localNotifications': {
      showSenderNudgeTriggeredNotification: async (payload) => {
        senderNotifications.push(payload);
        return `notif_${senderNotifications.length}`;
      },
    },
    '../diagnostics/runtimeStatus': { recordRuntimeStatus: async () => {} },
  });

  // 1st arrival inside geofence -> triggers & notifies sender
  await bg.evaluateSenderNudges({ latitude: 12.9716, longitude: 77.5946, accuracy: 15 });
  assert.equal(triggerCount, 1);
  assert.equal(senderNotifications.length, 1);
  assert.equal(senderNotifications[0].recipientName, 'Bob');
  assert.equal(senderNotifications[0].title, 'Gym Arrival');

  // 2nd check while still inside geofence -> blocked by exit hysteresis!
  await bg.evaluateSenderNudges({ latitude: 12.9718, longitude: 77.5946, accuracy: 15 });
  assert.equal(triggerCount, 1);
  assert.equal(senderNotifications.length, 1);

  // Move outside radius + hysteresis (~3.2 km away) -> clears inside state without triggering
  await bg.evaluateSenderNudges({ latitude: 12.9716 + 0.03, longitude: 77.5946, accuracy: 15 });
  assert.equal(triggerCount, 1);

  // Re-enter geofence after exiting -> triggers 2nd time & notifies sender!
  await bg.evaluateSenderNudges({ latitude: 12.9716, longitude: 77.5946, accuracy: 15 });
  assert.equal(triggerCount, 2);
  assert.equal(senderNotifications.length, 2);
});
