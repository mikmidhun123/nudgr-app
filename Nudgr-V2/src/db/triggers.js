import { getAuth, getFirestore, getServerTimestamp } from '../firebase';
import { isNudgeActive } from './nudges';
import {
  scheduleAllows,
  canTriggerByRepeatPolicy,
  localDateKey,
  localDayIndex,
  REPEAT_MODE,
} from '../location/geoUtils';

/**
 * 64-bit FNV-1a pure JS hashing function.
 * Deterministic, collision-resistant, and 100% React Native / Hermes compatible.
 */
function fnv1a64(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch * 31), 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${part1}${part2}`;
}

/**
 * Creates a deterministic trigger event ID from nudgeId + enterTime.
 * This prevents duplicate triggers from multiple geofence events or app restarts.
 */
export function generateTriggerEventId(nudgeId, enterTime) {
  const data = `${nudgeId}:${enterTime}`;
  return `trig_${fnv1a64(data)}`;
}

/**
 * Collection reference for trigger events subcollection.
 */
export function triggerEventsRef(nudgeId) {
  return getFirestore().collection('nudges').doc(nudgeId).collection('triggerEvents');
}

export const TRIGGER_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes default

/**
 * Creates an idempotent trigger event document using Firestore transactions.
 * Enforces repeat mode ('once', 'once_per_day', 'multiple_per_day') and cooldowns.
 *
 * @param {string} nudgeId - The Nudgr document ID
 * @param {object} params - { recipientUid, triggerLatitude, triggerLongitude, triggeredAt, observedAtMs }
 * @returns {Promise<{id: string, created: boolean, cooldown?: boolean, expired?: boolean}>}
 */
export async function createTriggerEvent(nudgeId, params = {}) {
  const currentUid = getAuth().currentUser?.uid;
  if (params.senderUid && params.senderUid !== currentUid) throw new Error('The signed-in account changed.');
  if (!currentUid) {
    throw new Error('You must be signed in to create a trigger event.');
  }

  const observedAtMs = params.observedAtMs ?? Date.now();
  if (!Number.isFinite(observedAtMs) || Date.now() - observedAtMs >= 300000 || observedAtMs - Date.now() > 30000) {
    return { id: null, created: false, expired: true };
  }
  const enterTime =
    params.observedAtMs ??
    params.triggeredAt?.toMillis?.() ??
    (typeof params.triggeredAt === 'number' ? params.triggeredAt : Date.now());
  const triggerEventId = generateTriggerEventId(nudgeId, enterTime);

  const db = getFirestore();
  const nudgeRef = db.collection('nudges').doc(nudgeId);
  const ref = triggerEventsRef(nudgeId).doc(triggerEventId);
  let created = false;
  let cooldownActive = false;

  console.log(`[FIREBASE_DIAG]\ntrigger event received\nwrite/read/listener started\ndocument/path being accessed = nudges/${nudgeId}/triggerEvents/${triggerEventId} & nudges/${nudgeId}`);

  try {
    await db.runTransaction(async (transaction) => {
      const nudgeDoc = await transaction.get(nudgeRef);
      if (!nudgeDoc.exists()) {
        created = false;
        return;
      }

      const nudgeData = nudgeDoc.data();
      const repeatMode = nudgeData.repeatMode || REPEAT_MODE.ONCE;
      const enterDate = new Date(enterTime);

      // Recheck live document: a cached ENTER can race a pause/cancel or schedule boundary.
      if (
        nudgeData.senderUid !== currentUid ||
        !['active', 'scheduled'].includes(nudgeData.status) ||
        !isNudgeActive(nudgeData, enterDate) ||
        !scheduleAllows(nudgeData, enterDate) ||
        (params.recipientUid && params.recipientUid !== nudgeData.recipientUid)
      ) {
        created = false;
        return;
      }

      // Check repeat policy & cooldown
      if (typeof canTriggerByRepeatPolicy === 'function') {
        if (!canTriggerByRepeatPolicy(nudgeData, enterDate, false)) {
          cooldownActive = true;
          created = false;
          return;
        }
      } else {
        const lastTrigger =
          nudgeData.lastTriggeredAt?.toMillis?.() ||
          (typeof nudgeData.lastTriggeredAt === 'number' ? nudgeData.lastTriggeredAt : null) ||
          nudgeData.triggeredAt?.toMillis?.() ||
          (typeof nudgeData.triggeredAt === 'number' ? nudgeData.triggeredAt : null);

        if (lastTrigger && enterTime - lastTrigger < TRIGGER_COOLDOWN_MS) {
          cooldownActive = true;
          created = false;
          return;
        }
      }

      // Check if this exact trigger event ID already exists
      const existingDoc = await transaction.get(ref);
      if (existingDoc.exists()) {
        created = false;
        return;
      }

      const triggerData = {
        nudgeId,
        triggerEventId,
        senderUid: currentUid,
        recipientUid: params.recipientUid || nudgeData.recipientUid || null,
        triggerLatitude: params.triggerLatitude,
        triggerLongitude: params.triggerLongitude,
        triggeredAt: params.triggeredAt ?? getServerTimestamp(),
        status: 'CREATED',
        deliveryVersion: 2,
        observedAtMs,
        createdAt: getServerTimestamp(),
        updatedAt: getServerTimestamp(),
      };

      const todayStr = typeof localDateKey === 'function' ? localDateKey(enterDate) : null;
      const dayIdx =
        typeof localDayIndex === 'function'
          ? localDayIndex(enterTime, nudgeData.timezoneOffsetMinutes)
          : null;

      transaction.set(ref, triggerData);
      transaction.update(nudgeRef, {
        status: repeatMode === REPEAT_MODE.ONCE ? 'triggered' : 'active',
        lastTriggeredAt: getServerTimestamp(),
        lastTriggerEventId: triggerEventId,
        lastTriggerExpiresAtMs: observedAtMs + 300000,
        ...(todayStr ? { lastTriggeredDate: todayStr } : {}),
        ...(typeof dayIdx === 'number' ? { lastTriggeredDayIndex: dayIdx } : {}),
        ...(nudgeData.recipientHidden ? { recipientHidden: false } : {}),
        triggeredAt: nudgeData.triggeredAt || getServerTimestamp(),
        updatedAt: getServerTimestamp(),
      });

      created = true;
    });

    console.log(`[FIREBASE_DIAG]\noperation result = ${created ? 'SUCCESS' : (cooldownActive ? 'SKIPPED (cooldown/repeat active)' : 'ALREADY_EXISTS')}\nerror if any = NONE`);
    if (created) {
      console.log(`[DELIVERY_TRACE] sender trigger\n→ data written/sent: document nudges/${nudgeId} updated, triggerEvent created\n→ recipient: ${params.recipientUid || 'unknown'}`);
    }
    return { id: triggerEventId, created, cooldown: cooldownActive };
  } catch (err) {
    console.error(`[FIREBASE_DIAG]\noperation result = FAILED\nerror if any = ${err.message}`);
    throw err;
  }
}

/**
 * Gets a trigger event by ID.
 */
export async function getTriggerEvent(nudgeId, triggerEventId) {
  const snap = await triggerEventsRef(nudgeId).doc(triggerEventId).get();
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getLatestTriggerEvent(nudgeId) {
  const snapshot = await triggerEventsRef(nudgeId).orderBy('createdAt', 'desc').limit(1).get();
  const latest = snapshot.docs[0];
  return latest ? { id: latest.id, ...latest.data() } : null;
}

/**
 * Updates trigger event status.
 */
export async function updateTriggerEventStatus(nudgeId, triggerEventId, status) {
  await triggerEventsRef(nudgeId).doc(triggerEventId).update({
    status,
    updatedAt: getServerTimestamp(),
  });
}

/**
 * Subscribes to trigger events for a Nudgr.
 */
export function subscribeTriggerEvents(nudgeId, onChange, onError) {
  return triggerEventsRef(nudgeId)
    .orderBy('triggeredAt', 'desc')
    .limit(10)
    .onSnapshot(
      (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => onError && onError(e)
    );
}
