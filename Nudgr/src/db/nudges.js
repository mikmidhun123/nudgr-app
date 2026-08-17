import { getAuth, getFirestore, getServerTimestamp } from '../firebase';

export const NUDGE_STATUS = {
  SCHEDULED: 'scheduled',
  ACTIVE: 'active',
  TRIGGERED: 'triggered',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export function nudgeCollection() {
  return getFirestore().collection('nudges');
}

export function nudgeDoc(id) {
  return nudgeCollection().doc(id);
}

/**
 * Creates a Nudgr document.
 *
 * The radius is the user-selected value (km) and is stored exactly as chosen.
 * The location engine uses radiusKm * 1000 metres — never a hardcoded 5 km.
 *
 * schedule is optional and may contain:
 *   { afterHour?: number (0-23 local hour guard),
 *     afterMinute?: number (0-59 minute guard),
 *     activeAfter?: number (epoch ms, earliest activation) }
 */
export async function createNudge({
  recipientUid,
  recipientName,
  message,
  triggerLatitude,
  triggerLongitude,
  triggerLabel,
  radiusKm,
  schedule,
  voiceStyle = 'normal',
}) {
  const sender = getAuth().currentUser;
  if (!sender) {
    throw new Error('You must be signed in to create a Nudgr.');
  }
  if (!recipientUid || recipientUid === sender.uid) {
    throw new Error('Choose a valid recipient.');
  }
  if (!message || !message.trim()) {
    throw new Error('Add a message for your Nudgr.');
  }
  if (
    typeof triggerLatitude !== 'number' ||
    typeof triggerLongitude !== 'number' ||
    typeof radiusKm !== 'number'
  ) {
    throw new Error('Set a trigger location and radius.');
  }

  const hasSchedule =
    schedule && (schedule.afterHour != null || schedule.activeAfter != null);

  const data = {
    senderUid: sender.uid,
    senderName: sender.displayName || sender.email || 'Someone',
    recipientUid,
    recipientName: recipientName || null,
    message: message.trim(),
    triggerLatitude,
    triggerLongitude,
    triggerLabel: triggerLabel || null,
    radiusKm,
    schedule: hasSchedule ? schedule : null,
    voiceStyle: voiceStyle || 'normal',
    status: hasSchedule ? NUDGE_STATUS.SCHEDULED : NUDGE_STATUS.ACTIVE,
    createdAt: getServerTimestamp(),
    updatedAt: getServerTimestamp(),
    triggeredAt: null,
  };

  const ref = await nudgeCollection().add(data);
  return { id: ref.id, ...data };
}

export async function updateNudge(id, fields) {
  await nudgeDoc(id).update({ ...fields, updatedAt: getServerTimestamp() });
}

export async function getNudge(id) {
  const snap = await nudgeDoc(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Marks a Nudgr as triggered.
 */
export async function markTriggered(id) {
  await nudgeDoc(id).update({
    status: NUDGE_STATUS.TRIGGERED,
    triggeredAt: getServerTimestamp(),
    updatedAt: getServerTimestamp(),
  });
}

/**
 * Recipient (or sender) marks the Nudgr completed/dismissed.
 */
export async function markCompleted(id) {
  await nudgeDoc(id).update({
    status: NUDGE_STATUS.COMPLETED,
    updatedAt: getServerTimestamp(),
  });
}

export async function cancelNudge(id) {
  await nudgeDoc(id).update({
    status: NUDGE_STATUS.CANCELLED,
    updatedAt: getServerTimestamp(),
  });
}

/** Live list of Nudgrs the current user has sent. */
export function subscribeSentNudges(uid, onChange, onError) {
  return nudgeCollection()
    .where('senderUid', '==', uid)
    .orderBy('createdAt', 'desc')
    .onSnapshot(
      (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => onError && onError(e)
    );
}

/** Live list of Nudgrs the current user is meant to receive. */
export function subscribeReceivedNudges(uid, onChange, onError) {
  return nudgeCollection()
    .where('recipientUid', '==', uid)
    .orderBy('createdAt', 'desc')
    .onSnapshot(
      (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => onError && onError(e)
    );
}
