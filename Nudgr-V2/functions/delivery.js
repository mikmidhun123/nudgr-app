const { createHash, randomUUID } = require('node:crypto');

const DELIVERY_TTL_MS = 5 * 60 * 1000;
const LEASE_MS = 90 * 1000;
const MAX_ATTEMPTS = 5;
const STALE_DEVICE_MS = 270 * 24 * 60 * 60 * 1000;
const TRANSIENT_ERRORS = new Set([
  'messaging/internal-error', 'messaging/server-unavailable', 'messaging/unavailable',
  'messaging/unknown-error', 'messaging/quota-exceeded', 'messaging/device-message-rate-exceeded',
  'messaging/topics-message-rate-exceeded', 'ETIMEDOUT', 'ECONNRESET', 'UNAVAILABLE', 'DEADLINE_EXCEEDED',
]);
const INVALID_TOKENS = new Set(['messaging/invalid-registration-token', 'messaging/registration-token-not-registered']);
const hash = token => createHash('sha256').update(token).digest('hex');
const millis = value => typeof value === 'number' ? value : value?.toMillis?.() || Date.parse(value) || 0;

function clipUtf8(value, bytes) {
  let text = String(value || '');
  if (Buffer.byteLength(text, 'utf8') <= bytes) return text;
  text = Array.from(text).slice(0, bytes).join('');
  while (Buffer.byteLength(text, 'utf8') > bytes) text = Array.from(text).slice(0, -1).join('');
  return text;
}

function createDelivery({ getFirestore, getMessaging, FieldValue, logger, now = Date.now, claimId = randomUUID }) {
  const db = () => getFirestore();
  const stamp = () => FieldValue.serverTimestamp();

  async function finish(ref, leaseId, update) {
    // A slow old invocation must not overwrite a newer lease or a client action.
    return db().runTransaction(async transaction => {
      const current = await transaction.get(ref);
      if (!current.exists || current.data().deliveryLeaseId !== leaseId) return false;
      transaction.update(ref, { ...update, deliveryLeaseId: null, leaseUntilMs: null, updatedAt: stamp() });
      return true;
    });
  }

  async function recipients(recipientUid) {
    const userRef = db().collection('users').doc(recipientUid);
    const [user, devices] = await Promise.all([userRef.get(), userRef.collection('devices').get()]);
    const deviceRecords = devices.docs || [];
    const registered = new Set(deviceRecords.map(doc => doc.data().fcmToken).filter(Boolean));
    const tokenDevices = new Map(), groups = new Map();
    for (const doc of deviceRecords) {
      const data = doc.data();
      if (typeof data.fcmToken !== 'string' || !data.fcmToken) continue;
      if (!groups.has(data.fcmToken)) groups.set(data.fcmToken, []);
      groups.get(data.fcmToken).push(doc);
    }
    for (const [token, records] of groups) {
      const installations = records.filter(doc => !doc.id.startsWith('legacy_'));
      const authoritative = installations.length ? installations : records;
      const enabled = authoritative.filter(doc => {
        const data = doc.data(), updatedAt = millis(data.updatedAt);
        return data.enabled !== false && (!installations.length || data.platform !== 'android' || !updatedAt || updatedAt > now() - STALE_DEVICE_MS);
      });
      if (enabled.length) tokenDevices.set(token, enabled.map(doc => doc.ref));
    }
    // Private legacy records preserve delivery during the staged client upgrade.
    for (const [token, active] of Object.entries(user.data()?.fcmTokens || {})) {
      if (active && token && !registered.has(token)) tokenDevices.set(token, []);
    }
    return { userRef, tokenDevices };
  }

  async function cleanup(userRef, tokenDevices, tokens) {
    if (!tokens.length) return;
    try {
      const update = {};
      for (const token of tokens) update[`fcmTokens.${token}`] = FieldValue.delete();
      await userRef.update(update);
      for (const token of tokens) {
        for (const ref of tokenDevices.get(token) || []) {
          await db().runTransaction(async transaction => {
            const current = await transaction.get(ref);
            if (current.exists && current.data().fcmToken === token) transaction.delete(ref);
          });
        }
      }
    } catch (failure) {
      logger.warn(`[FCM_TOKEN_CLEANUP_FAILED] error=${failure.code || 'unknown'}`);
    }
  }

  async function deliver(snap, context) {
    const nudgeId = context.params.nudgeId, triggerEventId = context.params.triggerEventId;
    const leaseId = claimId();
    const claim = await db().runTransaction(async transaction => {
      const current = await transaction.get(snap.ref);
      if (!current.exists) return null;
      const event = current.data(), time = now();
      const retryable = event.deliveryPending === true;
      if (event.status !== 'CREATED' && !retryable) return null;
      if (event.status === 'FCM_SENDING' && event.leaseUntilMs > time) return null;
      if (event.status !== 'CREATED' && event.nextAttemptAtMs > time) return null;
      const expiresAtMs = event.status === 'CREATED'
        ? Math.min((millis(event.createdAt) || time) + DELIVERY_TTL_MS,
          typeof event.observedAtMs === 'number' ? event.observedAtMs + DELIVERY_TTL_MS : Infinity)
        : event.expiresAtMs || (millis(event.createdAt) || time) + DELIVERY_TTL_MS;
      if (expiresAtMs <= time || (event.attemptCount || 0) >= MAX_ATTEMPTS) {
        transaction.update(snap.ref, { status: event.acceptedTokenHashes?.length ? 'FCM_SENT' : 'EXPIRED',
          error: 'DELIVERY_WINDOW_CLOSED', deliveryPending: false, nextAttemptAtMs: null, updatedAt: stamp() });
        return null;
      }
      const attemptCount = (event.attemptCount || 0) + 1;
      transaction.update(snap.ref, { status: 'FCM_SENDING', deliveryVersion: 2, deliveryLeaseId: leaseId,
        leaseUntilMs: time + LEASE_MS, nextAttemptAtMs: time + LEASE_MS, deliveryPending: true,
        expiresAtMs, attemptCount, updatedAt: stamp() });
      return { ...event, expiresAtMs, attemptCount };
    });
    if (!claim) {
      logger.info(`[FCM_SEND_SKIPPED] nudgeId=${nudgeId} triggerEventId=${triggerEventId} reason=CLAIM_OR_WINDOW`);
      return null;
    }

    const accepted = new Set(claim.acceptedTokenHashes || []);
    const targets = new Set(claim.targetTokenHashes || []);
    let retry = false, failureCode = null;
    try {
      const parent = await db().collection('nudges').doc(nudgeId).get();
      const nudge = parent.exists ? parent.data() : null;
      if (!nudge) throw Object.assign(new Error(), { code: 'NUDGR_MISSING' });
      if (!nudge.recipientUid) throw Object.assign(new Error(), { code: 'RECIPIENT_MISSING' });
      if (claim.senderUid !== nudge.senderUid || claim.recipientUid !== nudge.recipientUid || claim.nudgeId !== nudgeId) {
        throw Object.assign(new Error(), { code: 'TRIGGER_IDENTITY_MISMATCH' });
      }
      if (!['active', 'scheduled', 'triggered'].includes(nudge.status) ||
          (nudge.enabled === false && !(nudge.disableMode === 'today' && nudge.disabledUntil <= now())) ||
          (typeof nudge.schedule?.activeAfter === 'number' && nudge.schedule.activeAfter > now())) {
        throw Object.assign(new Error(), { code: 'NUDGR_INACTIVE' });
      }
      const pair = [nudge.senderUid, nudge.recipientUid].sort();
      const connection = await db().collection('connections').doc(pair.join('_')).get();
      if (!connection.exists || connection.data().status !== 'connected' ||
          connection.data().verification !== 'invitation-code' ||
          !pair.every(uid => connection.data().users?.includes(uid))) {
        throw Object.assign(new Error(), { code: 'CONNECTION_VERIFICATION_REQUIRED' });
      }
      const { userRef, tokenDevices } = await recipients(nudge.recipientUid);
      const allTokens = [...tokenDevices.keys()];
      allTokens.forEach(token => targets.add(hash(token)));
      const tokens = allTokens.filter(token => !accepted.has(hash(token)));
      if (!allTokens.length && !accepted.size) {
        throw Object.assign(new Error(), { code: 'RECIPIENT_TOKEN_MISSING' });
      }
      const senderName = clipUtf8(nudge.senderName || 'Someone', 160);
      const invalid = [];
      for (let offset = 0; offset < tokens.length; offset += 500) {
        if (claim.expiresAtMs <= now()) break;
        const batch = tokens.slice(offset, offset + 500);
        const payload = {
          notification: { title: '📍 Nudgr', body: `${senderName} sent you a Nudgr` },
          data: { nudgeId, triggerEventId, type: 'nudge_incoming', senderUid: nudge.senderUid,
            recipientUid: nudge.recipientUid, senderName, message: clipUtf8(nudge.message || 'Incoming Nudgr', 1000),
            expiresAt: String(claim.expiresAtMs) },
          tokens: batch,
          android: { priority: 'high', ttl: Math.max(0, claim.expiresAtMs - now()), notification: {
            channelId: 'nudgr_calls_v3', sound: 'ringtone', defaultSound: false, defaultVibrateTimings: false,
            priority: 'max', visibility: 'private', vibrateTimingsMillis: [0, 800, 200, 800], tag: `nudgr_${nudgeId}`,
          } },
          apns: { headers: { 'apns-priority': '10', 'apns-expiration': String(Math.floor(claim.expiresAtMs / 1000)) },
            payload: { aps: { contentAvailable: true, sound: 'ringtone.mp3', category: 'nudgr_incoming' } } },
        };
        logger.info(`[BACKEND_SEND_STARTED] nudgeId=${nudgeId} triggerEventId=${triggerEventId} tokenCount=${batch.length}`);
        try {
          const result = await getMessaging().sendEachForMulticast(payload);
          result.responses.forEach((response, index) => {
            if (response.success) accepted.add(hash(batch[index]));
            else {
              const code = response.error?.code || 'messaging/unknown-error';
              if (INVALID_TOKENS.has(code)) invalid.push(batch[index]);
              else if (TRANSIENT_ERRORS.has(code)) retry = true;
              failureCode = code;
            }
          });
        } catch (failure) {
          failureCode = failure.code || 'FCM_SEND_FAILED';
          const transient = TRANSIENT_ERRORS.has(failureCode);
          retry = retry || transient;
          if (!transient) break;
        }
        // Preserve accepted hashes before continuing another 500-token batch.
        // A transport crash before this write can replay FCM; device trigger-ID
        // deduplication is still required because FCM and Firestore aren't atomic.
        const renewed = await db().runTransaction(async transaction => {
          const current = await transaction.get(snap.ref);
          if (current.exists && current.data().deliveryLeaseId === leaseId) {
            const leaseUntilMs = Math.min(now() + LEASE_MS, claim.expiresAtMs);
            transaction.update(snap.ref, { acceptedTokenHashes: [...accepted], targetTokenHashes: [...targets],
              leaseUntilMs, nextAttemptAtMs: leaseUntilMs });
            return true;
          }
          return false;
        });
        if (!renewed) return null;
      }
      await complete();
      await cleanup(userRef, tokenDevices, invalid);
    } catch (failure) {
      failureCode = failure.code || 'FCM_SEND_FAILED';
      retry = TRANSIENT_ERRORS.has(failureCode) || ['UNAVAILABLE', 14, 4].includes(failure.code);
      await complete();
    }

    async function complete() {
      const time = now();
      const pending = retry && claim.attemptCount < MAX_ATTEMPTS && time + 15000 < claim.expiresAtMs;
      const status = accepted.size ? 'FCM_SENT' : claim.expiresAtMs <= time ? 'EXPIRED' : 'FCM_FAILED';
      await finish(snap.ref, leaseId, { status, acceptedTokenHashes: [...accepted], targetTokenHashes: [...targets],
        fcmSuccessCount: accepted.size, fcmFailureCount: Math.max(0, targets.size - accepted.size),
        ...(accepted.size ? { fcmSentAt: stamp() } : {}),
        error: accepted.size && !pending ? null : failureCode || 'FCM_ALL_TOKENS_FAILED',
        deliveryPending: pending, nextAttemptAtMs: pending ? Math.min(time + 15000 * (2 ** (claim.attemptCount - 1)), claim.expiresAtMs) : null,
        transportOutcome: status, lastAttemptAt: stamp(),
      });
      logger.info(`[${accepted.size ? 'FCM_SEND_SUCCESS' : 'FCM_SEND_FAILED'}] nudgeId=${nudgeId} success=${accepted.size} pendingRetry=${pending}`);
    }
    return null;
  }

  async function retryDue() {
    const group = db().collectionGroup('triggerEvents');
    const [created, due] = await Promise.all([
      group.where('deliveryVersion', '==', 2).where('status', '==', 'CREATED').limit(100).get(),
      group.where('deliveryPending', '==', true).where('nextAttemptAtMs', '<=', now()).limit(100).get(),
    ]);
    const unique = new Map([...created.docs, ...due.docs].map(doc => [doc.ref.path, doc]));
    // Bound concurrency to avoid an unbounded retry burst.
    const documents = [...unique.values()];
    for (let offset = 0; offset < documents.length; offset += 10) {
      await Promise.all(documents.slice(offset, offset + 10).map(doc => deliver(doc, {
        params: { nudgeId: doc.ref.parent.parent.id, triggerEventId: doc.id },
      })));
    }
    return null;
  }
  async function expireStaleDevices() {
    const cutoff = now() - STALE_DEVICE_MS;
    const candidates = await db().collectionGroup('devices').where('platform', '==', 'android').where('enabled', '==', true)
      .where('updatedAt', '<=', new Date(cutoff)).limit(500).get();
    for (const doc of candidates.docs) {
      if (doc.id.startsWith('legacy_')) continue;
      await db().runTransaction(async transaction => {
        const latest = await transaction.get(doc.ref);
        if (latest.exists && latest.data().enabled !== false && millis(latest.data().updatedAt) > 0 && millis(latest.data().updatedAt) <= cutoff) {
          transaction.update(doc.ref, { enabled: false });
        }
      });
    }
    return null;
  }
  return { deliver, retryDue, expireStaleDevices };
}

module.exports = { createDelivery, DELIVERY_TTL_MS, LEASE_MS, MAX_ATTEMPTS, clipUtf8 };
