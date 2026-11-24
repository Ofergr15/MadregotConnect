/**
 * b24 UNR — pure rules for the "hasn't read" nudge. The route does the reads; this decides who may be nudged.
 *
 * A nudge only ever goes to someone the caller's own screen lists as unread:
 * - moment: a receipt of THIS moment with read_at null (the coach's receipts screen).
 * - pack:   a member of THIS pack whose last_seen_at is before the week plan was published (the leader's home,
 *           same `readPlan` rule as GET /api/packs/:id/home).
 * Anything else in `athleteIds` is dropped silently and reported as `skipped`, never an error: the screen may be a
 * minute stale (someone read it meanwhile), and that is a success, not a failure.
 */
export const MAX_NUDGE_BATCH = 60;

export type NudgeContext = { type: 'moment'; momentId: string } | { type: 'pack'; packId: string };

const UUID = /^[0-9a-f-]{36}$/i;

export function parseNudgeBody(b: unknown): { context: NudgeContext; athleteIds: string[] } | { error: string } {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const ids = Array.isArray(o.athleteIds) ? o.athleteIds.filter((x): x is string => typeof x === 'string' && UUID.test(x)) : [];
  const uniq = Array.from(new Set(ids));
  if (!uniq.length) return { error: 'athleteIds is required' };
  if (uniq.length > MAX_NUDGE_BATCH) return { error: 'too many athleteIds' };
  if (typeof o.momentId === 'string' && UUID.test(o.momentId)) return { context: { type: 'moment', momentId: o.momentId }, athleteIds: uniq };
  if (typeof o.packId === 'string' && UUID.test(o.packId)) return { context: { type: 'pack', packId: o.packId }, athleteIds: uniq };
  return { error: 'momentId or packId is required' };
}

/** Moment: the unread receipts of that moment. */
export function eligibleFromReceipts(requested: string[], receipts: Array<{ athlete_id: string; read_at: string | null }>): string[] {
  const unread = new Set(receipts.filter((r) => !r.read_at).map((r) => r.athlete_id));
  return requested.filter((id) => unread.has(id));
}

/** Pack: members who haven't opened the app since the plan was published. No plan published → nobody to nudge. */
export function eligibleFromPack(
  requested: string[],
  members: Array<{ athleteId: string; lastSeenAt: string | null }>,
  publishedAt: string | null,
): string[] {
  if (!publishedAt) return [];
  const unread = new Set(members.filter((m) => !m.lastSeenAt || m.lastSeenAt < publishedAt).map((m) => m.athleteId));
  return requested.filter((id) => unread.has(id));
}

/** The push copy. First name of the sender only, like the moment push itself. */
export function nudgeCopy(senderName: string | null | undefined, ctx: NudgeContext['type']): { title: string; body: string } {
  const first = String(senderName || '').trim().split(/\s+/)[0] || 'המאמן';
  return ctx === 'moment'
    ? { title: `${first}: עוד לא קראת`, body: 'יש הודעה מהמאמן לשבוע הזה. לוקח דקה.' }
    : { title: `${first}: התוכנית לשבוע כבר כאן`, body: 'כדאי להציץ לפני האימון הבא.' };
}
