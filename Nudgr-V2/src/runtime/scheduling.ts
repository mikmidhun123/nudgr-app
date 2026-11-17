import { timestampMillis } from './incoming';

type ScheduleSpec = {
  activeAfter?: number | null;
  expiresAt?: number | null;
  startHour?: number | null;
  startMinute?: number | null;
  afterHour?: number | null;
  afterMinute?: number | null;
  endHour?: number | null;
  endMinute?: number | null;
  daysOfWeek?: number[] | null;
};

export type SenderNudge = {
  status?: string;
  enabled?: boolean;
  disableMode?: string;
  repeatMode?: string;
  cooldownMinutes?: number;
  lastTriggeredAt?: unknown;
  lastTriggeredDate?: string | null;
  disabledUntil?: number;
  schedule?: ScheduleSpec | null;
};

function localDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nextWindowOpening(schedule: ScheduleSpec | null | undefined, fromMs: number): number {
  const fromDate = new Date(fromMs);
  const startHour =
    typeof schedule?.startHour === 'number'
      ? schedule.startHour
      : typeof schedule?.afterHour === 'number'
      ? schedule.afterHour
      : null;
  const startMinute =
    typeof schedule?.startMinute === 'number'
      ? schedule.startMinute
      : typeof schedule?.afterMinute === 'number'
      ? schedule.afterMinute
      : 0;
  const days = Array.isArray(schedule?.daysOfWeek) && schedule.daysOfWeek.length > 0 ? schedule.daysOfWeek : null;

  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const candidate = new Date(fromDate);
    candidate.setDate(candidate.getDate() + dayOffset);
    if (dayOffset > 0) {
      candidate.setHours(startHour ?? 0, startHour !== null ? startMinute : 0, 0, 0);
    } else if (startHour !== null) {
      const targetToday = new Date(fromDate);
      targetToday.setHours(startHour, startMinute, 0, 0);
      if (targetToday.getTime() > fromMs) {
        candidate.setTime(targetToday.getTime());
      }
    }

    if (days && !days.includes(candidate.getDay())) {
      continue;
    }

    if (candidate.getTime() > fromMs) {
      return candidate.getTime();
    }
    if (dayOffset === 0 && (!days || days.includes(fromDate.getDay())) && startHour === null) {
      return fromMs;
    }
  }
  return 0;
}

export function nextSenderWakeup(nudges: SenderNudge[], now = Date.now(), pendingExpiresAt = 0): number {
  const deadlines: number[] = [];
  for (const nudge of nudges) {
    const repeatMode = nudge.repeatMode || 'once';
    const isOneShotDone = repeatMode === 'once' && ['triggered', 'completed', 'cancelled'].includes(nudge.status || '');
    if (nudge.status === 'cancelled' || isOneShotDone) continue;
    if (repeatMode === 'once' && !['active', 'scheduled'].includes(nudge.status || '')) continue;

    if (typeof nudge.schedule?.expiresAt === 'number' && nudge.schedule.expiresAt > 0 && now >= nudge.schedule.expiresAt) {
      continue;
    }

    const pausedToday = nudge.enabled === false && nudge.disableMode === 'today' && typeof nudge.disabledUntil === 'number';
    if (nudge.enabled === false && !pausedToday) continue;

    const resumeAt = pausedToday ? nudge.disabledUntil || 0 : 0;
    const due = nudge.schedule?.activeAfter;
    const scheduledAt = typeof due === 'number' && Number.isFinite(due) ? due : 0;
    const triggeredAt = timestampMillis(nudge.lastTriggeredAt);

    let repeatUnlockAt = 0;
    if (repeatMode === 'once_per_day') {
      const todayStr = localDateKey(now);
      const triggeredToday =
        nudge.lastTriggeredDate === todayStr ||
        (triggeredAt > 0 && localDateKey(triggeredAt) === todayStr);
      if (triggeredToday) {
        const nextMidnight = new Date(now);
        nextMidnight.setHours(24, 0, 0, 0);
        repeatUnlockAt = nextMidnight.getTime();
      }
    } else if (repeatMode === 'multiple_per_day') {
      const cooldownMins =
        typeof nudge.cooldownMinutes === 'number' && nudge.cooldownMinutes >= 5
          ? Math.min(720, nudge.cooldownMinutes)
          : 30;
      repeatUnlockAt = triggeredAt ? triggeredAt + cooldownMins * 60000 : 0;
    } else {
      repeatUnlockAt = triggeredAt ? triggeredAt + 1800000 : 0;
    }

    const baseEligible = Math.max(resumeAt, scheduledAt, repeatUnlockAt, now);
    const windowEligible = nextWindowOpening(nudge.schedule, baseEligible);
    const eligibleAfter = Math.max(resumeAt, scheduledAt, repeatUnlockAt, windowEligible);

    if (eligibleAfter > now) deadlines.push(eligibleAfter);
  }
  if (pendingExpiresAt > now) deadlines.push(Math.min(now + 30000, pendingExpiresAt));
  return deadlines.length ? Math.min(...deadlines) : 0;
}
