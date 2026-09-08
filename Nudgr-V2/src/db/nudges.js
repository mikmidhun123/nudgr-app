import { getAuth, getFirestore, getServerTimestamp } from '../firebase';

export const NUDGE_STATUS = {
  SCHEDULED: 'scheduled',
  ACTIVE: 'active',
  TRIGGERED: 'triggered',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export const NUDGE_DISABLE_MODE = {
  TODAY: 'today',
  MANUAL: 'manual',
};

export function nudgeCollection() {
  return getFirestore().collection('nudges');
}

export function nudgeDoc(id) {
  return nudgeCollection().doc(id);
}

/**
 * Determines whether a Nudgr is currently ON / active.
 * Handles "Today only" daily reset automatically when crossing into the next day.
 * 
 * @param {object} nudge - The Nudgr document
 * @param {Date} [now=new Date()] - Current time
 * @returns {boolean}
 */
export function isNudgeActive(nudge, now = new Date()) {
  if (!nudge) return false;
  if (nudge.status === NUDGE_STATUS.CANCELLED) return false;

  // If explicitly disabled with manual mode, it is OFF
  if (nudge.enabled === false && nudge.disableMode === NUDGE_DISABLE_MODE.MANUAL) {
    return false;
  }

  // If disabled for today only, check if we have crossed into the next calendar day
  if (nudge.disableMode === NUDGE_DISABLE_MODE.TODAY) {
    const todayStr = now.toISOString().split('T')[0];
    // If the disabled date is today or timestamp is before end of today, it remains OFF
    if (nudge.disabledUntilDate === todayStr) {
      return false;
    }
    if (typeof nudge.disabledUntil === 'number' && now.getTime() < nudge.disabledUntil) {
      return false;
    }
    // If date has passed, it automatically becomes active for today!
    return true;
  }

  // Default enabled check
  return nudge.enabled !== false;
}

/**
 * Gets a clean, user-friendly state descriptor for the Nudgr card.
 */
export function getNudgeStateSummary(nudge, now = new Date()) {
  const active = isNudgeActive(nudge, now);

  if (!active) {
    if (nudge?.disableMode === NUDGE_DISABLE_MODE.TODAY) {
      return {
        isActive: false,
        statusText: 'OFF',
        secondaryText: 'Paused for today',
      };
    }
    return {
      isActive: false,
      statusText: 'OFF',
      secondaryText: 'Turned off',
    };
  }

  if (nudge?.status === NUDGE_STATUS.TRIGGERED) {
    return {
      isActive: true,
      statusText: 'ON',
      secondaryText: 'Triggered',
    };
  }

  if (nudge?.status === NUDGE_STATUS.COMPLETED) {
    return {
      isActive: true,
      statusText: 'ON',
      secondaryText: 'Completed',
    };
  }

  return {
    isActive: true,
    statusText: 'ON',
    secondaryText: 'Active',
  };
}

/**
 * Sets the ON/OFF enabled state of a Nudgr.
 * 
 * @param {string} nudgeId - The Nudgr document ID
 * @param {boolean} enabled - true to turn ON, false to turn OFF
 * @param {string|null} [disableMode=null] - 'today' | 'manual' when turning OFF
 */
export async function setNudgeEnabled(nudgeId, enabled, disableMode = null) {
  if (!nudgeId) return;

  console.log(`[NUDGR_DEBUG] Setting Nudgr ${nudgeId} enabled: ${enabled}, mode: ${disableMode}`);

  if (enabled) {
    await updateNudge(nudgeId, {
      enabled: true,
      disableMode: null,
      disabledUntil: null,
      disabledUntilDate: null,
      status: NUDGE_STATUS.ACTIVE,
    });
    console.log(`[NUDGR_DEBUG] Nudgr ${nudgeId} turned ON`);
  } else {
    if (disableMode === NUDGE_DISABLE_MODE.TODAY) {
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      const todayStr = new Date().toISOString().split('T')[0];

      await updateNudge(nudgeId, {
        enabled: false,
        disableMode: NUDGE_DISABLE_MODE.TODAY,
        disabledUntil: endOfToday.getTime(),
        disabledUntilDate: todayStr,
      });
      console.log(`[NUDGR_DEBUG] Nudgr ${nudgeId} turned OFF (Today only, until ${endOfToday.toLocaleTimeString()})`);
    } else {
      await updateNudge(nudgeId, {
        enabled: false,
        disableMode: NUDGE_DISABLE_MODE.MANUAL,
        disabledUntil: null,
        disabledUntilDate: null,
      });
      console.log(`[NUDGR_DEBUG] Nudgr ${nudgeId} turned OFF (Until manually turned on)`);
    }
  }
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
  voiceNote = null,
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
    voiceNote: voiceNote || null,
    status: hasSchedule ? NUDGE_STATUS.SCHEDULED : NUDGE_STATUS.ACTIVE,
    enabled: true,
    disableMode: null,
    disabledUntil: null,
    disabledUntilDate: null,
    scheduledNotificationId: null,
    createdAt: getServerTimestamp(),
    updatedAt: getServerTimestamp(),
    triggeredAt: null,
  };

  const ref = await nudgeCollection().add(data);
  console.log('[NUDGR_DEBUG] Created Nudgr with ID:', ref.id, 'enabled: true');
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
    enabled: false,
    disableMode: NUDGE_DISABLE_MODE.MANUAL,
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
