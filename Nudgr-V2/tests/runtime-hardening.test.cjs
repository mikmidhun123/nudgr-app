const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function runtime(name) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, `src/runtime/${name}.ts`), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports, Promise, require: name => runtime(name.replace('./', '')) });
  return exports;
}
const { parseIncoming } = runtime('incoming');
const { createSessionManager } = runtime('session');
const { nextSenderWakeup } = runtime('scheduling');
const now = 2000000000000;
const valid = { recipientUid: 'recipient', nudgeId: 'n1', triggerEventId: 't1', expiresAt: now + 300000 };

test('incoming policy rejects signed-out, foreign, expired, malformed and excessive deadlines', () => {
  assert.ok(parseIncoming(valid, 'recipient', 0, now));
  for (const [data, uid] of [[valid, null], [valid, 'other'], [{ ...valid, expiresAt: now }, 'recipient'],
    [{ ...valid, expiresAt: 'NaN' }, 'recipient'], [{ ...valid, expiresAt: now + 86400000 }, 'recipient'],
    [{ ...valid, nudgeId: 'a/b' }, 'recipient'], [{ ...valid, triggerEventId: '' }, 'recipient']]) {
    assert.equal(parseIncoming(data, uid, 0, now), null);
  }
  const legacy = { ...valid }; delete legacy.expiresAt;
  assert.ok(parseIncoming(legacy, 'recipient', now, now));
  assert.equal(parseIncoming(legacy, 'recipient', now - 300001, now), null);
});

test('an account switch disposes old resources and immediately disposes late subscriptions', async () => {
  const stopped = [], errors = [];
  const manager = createSessionManager(error => errors.push(error));
  const first = manager.begin('first');
  first.addCleanup(() => stopped.push('first'));
  first.addCleanup(() => { throw new Error('cleanup failed'); });
  first.addCleanup(() => stopped.push('after-error'));
  const second = manager.begin('second');
  first.addCleanup(() => stopped.push('late-first'));
  second.addCleanup(() => stopped.push('second'));
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  manager.invalidate();
  assert.deepEqual(stopped, ['first', 'after-error', 'late-first', 'second']);
  assert.equal(errors.length, 1);
  assert.equal(second.isCurrent(), false);
});

test('wake planning preserves day pause, later activation, explicit re-arm cooldown and offline expiry', () => {
  assert.equal(nextSenderWakeup([{ status: 'scheduled', schedule: { activeAfter: now + 50000 } }], now), now + 50000);
  assert.equal(nextSenderWakeup([{ status: 'active', enabled: false, disableMode: 'today', disabledUntil: now + 20000,
    schedule: { activeAfter: now + 50000 } }], now), now + 50000);
  assert.equal(nextSenderWakeup([{ status: 'scheduled', enabled: false, disableMode: 'today', disabledUntil: now - 1,
    schedule: { activeAfter: now + 50000 } }], now), now + 50000);
  assert.equal(nextSenderWakeup([{ status: 'active', lastTriggeredAt: now - 1790000 }], now), now + 10000);
  assert.equal(nextSenderWakeup([{ status: 'completed', schedule: { activeAfter: now + 1 } }], now), 0);
  assert.equal(nextSenderWakeup([{ status: 'active', enabled: false, disableMode: 'manual' }], now), 0);
  assert.equal(nextSenderWakeup([], now, now + 10000), now + 10000);
  assert.equal(nextSenderWakeup([], now, now + 100000), now + 30000);
});
