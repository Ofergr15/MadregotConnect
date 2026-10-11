// ═════════════════════════════════════════════════════════════════════════════
// "SEND AGAIN, CLOSE TO THE SESSION" — what the coach is told before it.
//
// Saturday 2026-10-10, 23:20 / 23:40 / 23:43 Israel: Sunday went to the group
// three times. Every re-send deletes the copy before it on Garmin, so a watch that
// synced in between holds nothing until it syncs again; 8 of 15 Sunday runners
// ran it from the watch, against 12-16 on other days. Not a block: the sheet
// says what the send will do, and recommends the "updated, sync again" push.
// ═════════════════════════════════════════════════════════════════════════════

export interface SentDay { lastSentAt: string; athletes: number }

export function sentDaysFrom(rows: Array<{ workout_date: string; athlete_id: string; created_at: string }>): Record<string, SentDay> {
  const acc = new Map<string, { last: string; who: Set<string> }>();
  for (const r of rows) {
    if (!r.workout_date || !r.created_at) continue;
    const cur = acc.get(r.workout_date) ?? { last: r.created_at, who: new Set<string>() };
    if (r.created_at > cur.last) cur.last = r.created_at;
    cur.who.add(r.athlete_id);
    acc.set(r.workout_date, cur);
  }
  return Object.fromEntries([...acc].map(([d, v]) => [d, { lastSentAt: new Date(v.last).toISOString(), athletes: v.who.size }]));
}

/** Club sessions start early; without a time on the session, assume 05:30 Israel. */
export const DEFAULT_SESSION_HOUR = 5.5;
export const WARN_WITHIN_HOURS = 12;

export interface ResendWarning { dates: string[]; athletes: number; lastSentAt: string; hoursToSession: number }

/**
 * The warning, or null. `dates` = the dates this send covers; only those already
 * sent count, and only when the earliest of them starts within WARN_WITHIN_HOURS.
 */
export function resendWarning(dates: string[], sent: Record<string, SentDay>, now: Date = new Date()): ResendWarning | null {
  const resent = dates.filter((d) => sent[d]).sort();
  if (!resent.length) return null;
  const first = resent[0];
  // 05:30 Israel = 02:30Z in summer time; close enough for a 12h window either way.
  const start = new Date(`${first}T00:00:00Z`).getTime() + (DEFAULT_SESSION_HOUR - 3) * 3600_000;
  const hours = (start - now.getTime()) / 3600_000;
  if (hours > WARN_WITHIN_HOURS || hours < -12) return null;
  const athletes = Math.max(...resent.map((d) => sent[d].athletes));
  const lastSentAt = resent.map((d) => sent[d].lastSentAt).sort().at(-1)!;
  return { dates: resent, athletes, lastSentAt, hoursToSession: Math.max(0, Math.round(hours)) };
}
