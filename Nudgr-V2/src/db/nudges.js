import { getApp, getAuth, getFirestore, getServerTimestamp, isQaBuild } from '../firebase';

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

export const NUDGE_REPEAT_MODE = {
  ONCE: 'once',
  ONCE_PER_DAY: 'once_per_day',
  MULTIPLE_PER_DAY: 'multiple_per_day',
};

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function nudgeCollection() {
  return getFirestore().collection('nudges');
}

export function nudgeDoc(id) {
  return nudgeCollection().doc(id);
}

/**
 * Determines whether a Nudgr is currently ON / active.
 * Handles "Today only" daily reset automatically when crossing into the next day,
 * and keeps repeating alarms ('once_per_day', 'multiple_per_day') active across triggers.
 *
 * @param {object} nudge - The Nudgr document
 * @param {Date} [now=new Date()] - Current time
 * @returns {boolean}
 */
export function isNudgeActive(nudge, now = new Date()) {
  if (!nudge) return false;
  if (nudge.status === NUDGE_STATUS.CANCELLED) return false;

  const repeatMode = nudge.repeatMode || NUDGE_REPEAT_MODE.ONCE;
  if (
    repeatMode === NUDGE_REPEAT_MODE.ONCE &&
    [NUDGE_STATUS.COMPLETED, NUDGE_STATUS.TRIGGERED].includes(nudge.status)
  ) {
    return false;
  }

  if (typeof nudge.schedule?.expiresAt === 'number' && nudge.schedule.expiresAt > 0 && now.getTime() >= nudge.schedule.expiresAt) {
    return false;
  }

  // If explicitly disabled with manual mode, it is OFF
  if (nudge.enabled === false && nudge.disableMode === NUDGE_DISABLE_MODE.MANUAL) {
    return false;
  }

  // If disabled for today only, check if we have crossed into the next calendar day
  if (nudge.disableMode === NUDGE_DISABLE_MODE.TODAY) {
    const todayStr = localDateKey(now);
    if (nudge.disabledUntilDate === todayStr) {
      return false;
    }
    if (typeof nudge.disabledUntil === 'number' && now.getTime() < nudge.disabledUntil) {
      return false;
    }
    return true;
  }

  return nudge.enabled !== false;
}

/**
 * Gets a clean, user-friendly state descriptor for the Nudgr card.
 */
export function getNudgeStateSummary(nudge, now = new Date()) {
  const repeatMode = nudge?.repeatMode || NUDGE_REPEAT_MODE.ONCE;
  if (repeatMode === NUDGE_REPEAT_MODE.ONCE && [NUDGE_STATUS.COMPLETED, NUDGE_STATUS.TRIGGERED].includes(nudge?.status)) {
    return {
      isActive: false,
      statusText: 'OFF',
      secondaryText:
        nudge.status === NUDGE_STATUS.COMPLETED
          ? 'Completed · Sender can re-arm'
          : 'Triggered · Open history',
    };
  }

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

  const todayStr = localDateKey(now);
  if (repeatMode === NUDGE_REPEAT_MODE.ONCE_PER_DAY) {
    if (nudge?.lastTriggeredDate === todayStr) {
      return {
        isActive: true,
        statusText: 'ON',
        secondaryText: 'Rang today · Armed for tomorrow',
      };
    }
    return {
      isActive: true,
      statusText: 'ON',
      secondaryText: 'Active · Once a day',
    };
  }

  if (repeatMode === NUDGE_REPEAT_MODE.MULTIPLE_PER_DAY) {
    const mins = typeof nudge?.cooldownMinutes === 'number' ? nudge.cooldownMinutes : 30;
    return {
      isActive: true,
      statusText: 'ON',
      secondaryText: `Active · Multi (${mins}m cooldown)`,
    };
  }

  if (nudge?.status === NUDGE_STATUS.SCHEDULED) {
    return {
      isActive: true,
      statusText: 'ON',
      secondaryText: 'Scheduled',
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
 * When the sender turns a Nudgr ON, recipientHidden is reset to false so that
 * any previously hidden Nudgr reappears on the recipient's phone.
 *
 * @param {string} nudgeId - The Nudgr document ID
 * @param {boolean} enabled - true to turn ON, false to turn OFF
 * @param {string|null} [disableMode=null] - 'today' | 'manual' when turning OFF
 */
export async function setNudgeEnabled(nudgeId, enabled, disableMode = null) {
  if (!nudgeId) return;

  console.log(`[NUDGR_DEBUG] Setting Nudgr ${nudgeId} enabled: ${enabled}, mode: ${disableMode}`);

  if (enabled) {
    const current = await getNudge(nudgeId);
    if (!current) throw new Error('This Nudgr is no longer available.');
    const myUid = getAuth().currentUser?.uid;
    if (
      [NUDGE_STATUS.COMPLETED, NUDGE_STATUS.CANCELLED, NUDGE_STATUS.TRIGGERED].includes(current.status) &&
      current.senderUid !== myUid
    ) {
      throw new Error('Ask the sender to re-arm this Nudgr.');
    }
    await updateNudge(nudgeId, {
      enabled: true,
      ...(current.senderUid === myUid ? { recipientHidden: false } : {}),
      ...([NUDGE_STATUS.COMPLETED, NUDGE_STATUS.CANCELLED, NUDGE_STATUS.TRIGGERED].includes(current?.status)
        ? { status: NUDGE_STATUS.ACTIVE }
        : {}),
      disableMode: null,
      disabledUntil: null,
      disabledUntilDate: null,
    });
    console.log(`[NUDGR_DEBUG] Nudgr ${nudgeId} turned ON`);
  } else {
    if (disableMode === NUDGE_DISABLE_MODE.TODAY) {
      const endOfToday = new Date();
      const todayStr = localDateKey(endOfToday);
      endOfToday.setHours(24, 0, 0, 0);

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
 * Recipient swipes left-to-right to hide a received Nudgr from their list.
 * If the sender subsequently turns the Nudgr ON, recipientHidden resets to false.
 */
export async function hideReceivedNudge(nudgeId) {
  if (!nudgeId) return;
  try {
    await updateNudge(nudgeId, { recipientHidden: true });
  } catch (_) {
    // Fallback for legacy deployed rulesets before recipientHidden rule rollout
    await updateNudge(nudgeId, {
      enabled: false,
      disableMode: 'recipient_hidden',
      disabledUntil: null,
      disabledUntilDate: null,
    });
  }
}

/**
 * Normalizes and validates schedule payload fields.
 */
function normalizeSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') return null;
  const out = {};

  const startHour =
    typeof schedule.startHour === 'number'
      ? schedule.startHour
      : typeof schedule.afterHour === 'number'
      ? schedule.afterHour
      : null;
  const startMinute =
    typeof schedule.startMinute === 'number'
      ? schedule.startMinute
      : typeof schedule.afterMinute === 'number'
      ? schedule.afterMinute
      : 0;

  if (startHour !== null && startHour >= 0 && startHour <= 23) {
    out.startHour = Math.floor(startHour);
    out.startMinute = Math.max(0, Math.min(59, Math.floor(startMinute)));
    // Keep afterHour/afterMinute aliases for backward compatibility
    out.afterHour = out.startHour;
    out.afterMinute = out.startMinute;
  }

  if (typeof schedule.endHour === 'number' && schedule.endHour >= 0 && schedule.endHour <= 23) {
    out.endHour = Math.floor(schedule.endHour);
    out.endMinute =
      typeof schedule.endMinute === 'number'
        ? Math.max(0, Math.min(59, Math.floor(schedule.endMinute)))
        : 59;
  }

  if (typeof schedule.afterTimeText === 'string' && schedule.afterTimeText.trim()) {
    out.afterTimeText = schedule.afterTimeText.trim().slice(0, 60);
  }

  if (Array.isArray(schedule.daysOfWeek)) {
    const validDays = [...new Set(schedule.daysOfWeek.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (validDays.length > 0 && validDays.length < 7) {
      out.daysOfWeek = validDays;
    }
  }

  if (typeof schedule.activeAfter === 'number' && Number.isFinite(schedule.activeAfter) && schedule.activeAfter > 0) {
    out.activeAfter = schedule.activeAfter;
  }

  if (typeof schedule.expiresAt === 'number' && Number.isFinite(schedule.expiresAt) && schedule.expiresAt > 0) {
    out.expiresAt = schedule.expiresAt;
  }

  if (typeof schedule.type === 'string') {
    out.type = schedule.type;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Creates a Nudgr document.
 *
 * The radius is the user-selected value (km) and is stored exactly as chosen.
 * The location engine uses radiusKm * 1000 metres — never a hardcoded 5 km.
 */
export async function createNudge({
  recipientUid,
  recipientName,
  title = null,
  message,
  triggerLatitude,
  triggerLongitude,
  triggerLabel,
  radiusKm,
  schedule,
  repeatMode = NUDGE_REPEAT_MODE.ONCE,
  cooldownMinutes = 30,
  requireExitBeforeRetrigger = true,
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
    !Number.isFinite(triggerLatitude) || Math.abs(triggerLatitude) > 90 ||
    !Number.isFinite(triggerLongitude) || Math.abs(triggerLongitude) > 180 ||
    !Number.isFinite(radiusKm) || radiusKm < 2.5 || radiusKm > 10
  ) {
    throw new Error('Set a trigger location and radius.');
  }

  const normalizedSchedule = normalizeSchedule(schedule);
  const hasSchedule =
    normalizedSchedule &&
    (normalizedSchedule.startHour != null ||
      normalizedSchedule.afterHour != null ||
      normalizedSchedule.activeAfter != null ||
      (Array.isArray(normalizedSchedule.daysOfWeek) && normalizedSchedule.daysOfWeek.length > 0));

  const validRepeatMode = Object.values(NUDGE_REPEAT_MODE).includes(repeatMode)
    ? repeatMode
    : NUDGE_REPEAT_MODE.ONCE;
  const validCooldown =
    typeof cooldownMinutes === 'number' && Number.isFinite(cooldownMinutes)
      ? Math.max(5, Math.min(720, Math.round(cooldownMinutes)))
      : 30;
  const tzOffsetMin = -new Date().getTimezoneOffset();

  const data = {
    senderUid: sender.uid,
    senderName: String(sender.displayName || sender.email || 'Someone').trim().slice(0, 100) || 'Someone',
    recipientUid,
    recipientName: recipientName || null,
    title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 80) : null,
    message: message.trim(),
    triggerLatitude,
    triggerLongitude,
    triggerLabel: triggerLabel || null,
    radiusKm,
    schedule: hasSchedule ? normalizedSchedule : null,
    repeatMode: validRepeatMode,
    cooldownMinutes: validCooldown,
    requireExitBeforeRetrigger: requireExitBeforeRetrigger !== false,
    timezoneOffsetMinutes: tzOffsetMin,
    voiceStyle: voiceStyle || 'normal',
    voiceNote: voiceNote || null,
    status:
      normalizedSchedule?.activeAfter && normalizedSchedule.activeAfter > Date.now()
        ? NUDGE_STATUS.SCHEDULED
        : NUDGE_STATUS.ACTIVE,
    enabled: true,
    recipientHidden: false,
    disableMode: null,
    disabledUntil: null,
    disabledUntilDate: null,
    scheduledNotificationId: null,
    lastTriggeredDate: null,
    lastTriggeredDayIndex: null,
    createdAt: getServerTimestamp(),
    updatedAt: getServerTimestamp(),
    triggeredAt: null,
  };

  const ref = await nudgeCollection().add(data);
  console.log(`[NUDGR_DIAG]\nNudgr creation SUCCESS\nNudgr ID = ${ref.id}\nsenderUid = ${data.senderUid}\nrecipientUid = ${data.recipientUid}\nconfigured center = lat ${data.triggerLatitude}, lon ${data.triggerLongitude}\nconfigured radius = ${data.radiusKm} km\nrepeatMode = ${data.repeatMode}\nstatus = ${data.status}\nenabled = true`);
  return { id: ref.id, ...data };
}

export async function updateNudge(id, fields) {
  await nudgeDoc(id).update({ ...fields, updatedAt: getServerTimestamp() });
}

/**
 * Updates editable alarm properties on an existing Nudgr owned by the sender.
 */
export async function updateNudgeDetails(id, fields = {}) {
  const current = await getNudge(id);
  if (!current) throw new Error('Nudgr not found.');
  const myUid = getAuth().currentUser?.uid;
  if (!myUid || current.senderUid !== myUid) {
    throw new Error('Only the sender can edit this Nudgr.');
  }

  const patch = {};
  if ('title' in fields) {
    patch.title = typeof fields.title === 'string' && fields.title.trim() ? fields.title.trim().slice(0, 80) : null;
  }
  if ('message' in fields) {
    if (!fields.message || !fields.message.trim()) throw new Error('Message cannot be empty.');
    patch.message = fields.message.trim();
  }
  if ('triggerLatitude' in fields || 'triggerLongitude' in fields || 'radiusKm' in fields) {
    const lat = fields.triggerLatitude ?? current.triggerLatitude;
    const lon = fields.triggerLongitude ?? current.triggerLongitude;
    const rad = fields.radiusKm ?? current.radiusKm;
    if (
      !Number.isFinite(lat) || Math.abs(lat) > 90 ||
      !Number.isFinite(lon) || Math.abs(lon) > 180 ||
      !Number.isFinite(rad) || rad < 2.5 || rad > 10
    ) {
      throw new Error('Set a valid trigger location and radius (2.5–10 km).');
    }
    patch.triggerLatitude = lat;
    patch.triggerLongitude = lon;
    patch.radiusKm = rad;
  }
  if ('triggerLabel' in fields) {
    patch.triggerLabel = fields.triggerLabel || null;
  }
  if ('schedule' in fields) {
    patch.schedule = normalizeSchedule(fields.schedule);
  }
  if ('repeatMode' in fields && Object.values(NUDGE_REPEAT_MODE).includes(fields.repeatMode)) {
    patch.repeatMode = fields.repeatMode;
  }
  if ('cooldownMinutes' in fields && typeof fields.cooldownMinutes === 'number') {
    patch.cooldownMinutes = Math.max(5, Math.min(720, Math.round(fields.cooldownMinutes)));
  }
  if ('requireExitBeforeRetrigger' in fields) {
    patch.requireExitBeforeRetrigger = fields.requireExitBeforeRetrigger !== false;
  }
  if ('voiceStyle' in fields) {
    patch.voiceStyle = fields.voiceStyle || 'normal';
  }
  if ('voiceNote' in fields) {
    patch.voiceNote = fields.voiceNote || null;
  }
  if ('enabled' in fields) {
    patch.enabled = Boolean(fields.enabled);
  }

  patch.timezoneOffsetMinutes = -new Date().getTimezoneOffset();
  if (patch.enabled !== false && current.enabled !== false) {
    patch.recipientHidden = false;
  }

  await updateNudge(id, patch);
  return { ...current, ...patch };
}

/**
 * Permanently deletes a sender-owned Nudgr document, its trigger/receipt subcollections,
 * and its Cloudflare R2 voice recording via the authenticated deleteNudge backend endpoint.
 * Falls back to R2 Worker deletion + Firestore soft-delete if the Cloud Function endpoint
 * is not yet deployed on the live project.
 */
export async function deleteNudge(nudgeId) {
  if (!nudgeId || typeof nudgeId !== 'string') {
    throw new Error('A valid Nudgr ID is required.');
  }
  const user = getAuth().currentUser;
  if (!user) {
    throw new Error('You must be signed in to delete a Nudgr.');
  }

  const current = await getNudge(nudgeId).catch(() => null);
  const storageKey = current?.voiceNote?.storageKey || null;

  const token = await user.getIdToken();
  const projectId = getApp?.()?.options?.projectId || 'nudgr-e6049';
  const endpoint = isQaBuild
    ? 'http://127.0.0.1:5008/deleteNudge'
    : `https://us-central1-${projectId}.cloudfunctions.net/deleteNudge`;

  const fallbackSoftDelete = async () => {
    if (storageKey) {
      const workerBase =
        (isQaBuild ? 'http://127.0.0.1:5008' : process.env.EXPO_PUBLIC_R2_BACKEND_URL) ||
        'https://nudgr-voice-api.mikmidhun123.workers.dev';
      await fetch(`${workerBase}/deleteVoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ nudgeId, storageKey }),
      }).catch(() => {});
    }
    try {
      await nudgeDoc(nudgeId).delete();
    } catch (_) {
      await updateNudge(nudgeId, {
        status: NUDGE_STATUS.CANCELLED,
        enabled: false,
        disableMode: NUDGE_DISABLE_MODE.MANUAL,
        deleted: true,
        recipientHidden: true,
        voiceNote: null,
      });
    }
    return { deleted: true, nudgeId, fallback: true };
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ nudgeId }),
    });

    const rawText = await response.text();
    let result = null;
    try {
      result = JSON.parse(rawText);
    } catch (parseErr) {
      if (!isQaBuild) return await fallbackSoftDelete();
      throw new Error('Delete service returned an unexpected response.', { cause: parseErr });
    }

    if (!response.ok) {
      if (!isQaBuild && (response.status === 404 || response.status === 502 || response.status === 503)) {
        return await fallbackSoftDelete();
      }
      throw new Error(result?.message || result?.error || 'Could not delete Nudgr. Please try again.');
    }

    return result;
  } catch (err) {
    if (!isQaBuild && /unexpected character|json|network|failed to fetch|404/i.test(err.message || '')) {
      return await fallbackSoftDelete();
    }
    throw err;
  }
}

export async function getNudge(id) {
  const uid = getAuth().currentUser?.uid;
  if (!uid) return null;
  const snap = await nudgeDoc(id).get();
  if (!snap.exists() || getAuth().currentUser?.uid !== uid) return null;
  const data = snap.data();
  return [data.senderUid, data.recipientUid].includes(uid)
    ? {
        id: snap.id,
        ...data,
        senderName: typeof data.senderName === 'string' ? data.senderName.slice(0, 100) : 'Someone',
        message: typeof data.message === 'string' ? data.message : '',
      }
    : null;
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
 * Only one-shot ('once') Nudgrs transition to status='completed', enabled=false.
 * Repeating Nudgrs ('once_per_day', 'multiple_per_day') remain active for future occurrences.
 */
export async function markCompleted(id, expectedTriggerId = null) {
  const fields = {
    status: NUDGE_STATUS.COMPLETED,
    enabled: false,
    updatedAt: getServerTimestamp(),
  };
  if (!expectedTriggerId) {
    const snap = await nudgeDoc(id).get();
    if (!snap.exists()) return;
    const data = snap.data();
    if ((data.repeatMode || NUDGE_REPEAT_MODE.ONCE) !== NUDGE_REPEAT_MODE.ONCE) {
      return;
    }
    return nudgeDoc(id).update(fields);
  }
  return getFirestore().runTransaction(async (transaction) => {
    const ref = nudgeDoc(id),
      snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    if ((data.repeatMode || NUDGE_REPEAT_MODE.ONCE) !== NUDGE_REPEAT_MODE.ONCE) {
      return;
    }
    if (data.status === NUDGE_STATUS.TRIGGERED && data.lastTriggerEventId === expectedTriggerId) {
      transaction.update(ref, fields);
    }
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
      (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((n) => !n.deleted)),
      (e) => onError && onError(e)
    );
}

/** Live list of Nudgrs the current user is meant to receive. */
export function subscribeReceivedNudges(uid, onChange, onError) {
  return nudgeCollection()
    .where('recipientUid', '==', uid)
    .orderBy('createdAt', 'desc')
    .onSnapshot(
      (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((n) => !n.deleted)),
      (e) => onError && onError(e)
    );
}
