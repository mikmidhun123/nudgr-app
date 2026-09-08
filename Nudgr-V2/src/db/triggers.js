import { getAuth, getFirestore, getServerTimestamp } from '../firebase';

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

export const TRIGGER_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Creates an idempotent trigger event document using Firestore transactions.
 * Enforces a strict 30-minute cooldown per Nudgr.
 * 
 * @param {string} nudgeId - The Nudgr document ID
 * @param {object} params - { recipientUid, triggerLatitude, triggerLongitude, triggeredAt }
 * @returns {Promise<{id: string, created: boolean, cooldown?: boolean}>}
 */
export async function createTriggerEvent(nudgeId, params = {}) {
  const currentUid = getAuth().currentUser?.uid;
  if (!currentUid) {
    throw new Error('You must be signed in to create a trigger event.');
  }

  const enterTime =
    params.triggeredAt?.toMillis?.() ??
    (typeof params.triggeredAt === 'number' ? params.triggeredAt : Date.now());
  const triggerEventId = generateTriggerEventId(nudgeId, enterTime);

  const db = getFirestore();
  const nudgeRef = db.collection('nudges').doc(nudgeId);
  const ref = triggerEventsRef(nudgeId).doc(triggerEventId);
  let created = false;
  let cooldownActive = false;

  await db.runTransaction(async (transaction) => {
    // 1. Check parent Nudgr document for cooldown
    const nudgeDoc = await transaction.get(nudgeRef);
    if (!nudgeDoc.exists) {
      created = false;
      return;
    }

    const nudgeData = nudgeDoc.data();
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

    // 2. Check if this exact trigger event ID already exists
    const existingDoc = await transaction.get(ref);
    if (existingDoc.exists) {
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
      createdAt: getServerTimestamp(),
      updatedAt: getServerTimestamp(),
    };

    transaction.set(ref, triggerData);
    transaction.update(nudgeRef, {
      status: 'triggered',
      lastTriggeredAt: getServerTimestamp(),
      triggeredAt: nudgeData.triggeredAt || getServerTimestamp(),
      updatedAt: getServerTimestamp(),
    });

    created = true;
  });

  return { id: triggerEventId, created, cooldown: cooldownActive };
}

/**
 * Gets a trigger event by ID.
 */
export async function getTriggerEvent(nudgeId, triggerEventId) {
  const snap = await triggerEventsRef(nudgeId).doc(triggerEventId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
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
    .onSnapshot(
      (snap) => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (e) => onError && onError(e)
    );
}
