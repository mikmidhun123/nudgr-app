export const DELIVERY_TTL_MS = 300000;
export type IncomingPayload = {
  nudgeId: string; triggerEventId: string; recipientUid: string;
  senderName: string; message: string; expiresAt: number;
};
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 160 && !value.includes('/');

export function timestampMillis(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    const result: unknown = value.toMillis();
    return typeof result === 'number' && Number.isFinite(result) ? result : 0;
  }
  if (value && typeof value === 'object') {
    const saved = value as { seconds?: unknown; _seconds?: unknown; nanoseconds?: unknown; _nanoseconds?: unknown };
    const seconds = saved.seconds ?? saved._seconds, nanos = saved.nanoseconds ?? saved._nanoseconds ?? 0;
    if (typeof seconds === 'number' && Number.isFinite(seconds) && typeof nanos === 'number' && Number.isFinite(nanos)) return seconds * 1000 + nanos / 1000000;
  }
  return 0;
}

export function parseIncoming(data: Record<string, unknown> | undefined, uid: string | null | undefined,
  sentTime: unknown = 0, now = Date.now()): IncomingPayload | null {
  if (!data || !uid || data.recipientUid !== uid || !validId(data.nudgeId)) return null;
  const triggerEventId = data.triggerEventId || data.triggerId;
  if (!validId(triggerEventId)) return null;
  const expiresAt = data.expiresAt === undefined ? timestampMillis(sentTime) + DELIVERY_TTL_MS
    : typeof data.expiresAt === 'string' || typeof data.expiresAt === 'number' ? Number(data.expiresAt) : 0;
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + DELIVERY_TTL_MS + 30000) return null;
  return { nudgeId: data.nudgeId, triggerEventId, recipientUid: uid, expiresAt,
    senderName: typeof data.senderName === 'string' ? data.senderName.slice(0, 100) : 'Someone',
    message: typeof data.message === 'string' ? data.message : 'Incoming Nudgr' };
}
