/**
 * The academy's three service promises (design/academy-prototype NOTES.md), as pure rules so
 * the coach home and the manager home count them from ONE function and can never disagree:
 *
 *   1. next plan week ready by Saturday 20:00 Israel (the moment getDisplayWeekStart rolls
 *      athletes forward to preview it);
 *   2. trainee feedback answered within 24 h;
 *   3. coach contact at least every 7 days.
 *
 * Plan week = Sunday (src/lib/utils.ts). Everything here takes `now` explicitly.
 */

export const REPLY_SLA_HOURS = 24;
export const CONTACT_SLA_DAYS = 7;
/** Hour (Israel wall clock) on the Saturday before the plan week. */
export const PLAN_DEADLINE_HOUR = 20;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Israel's UTC offset in hours at `at` (2 in winter, 3 in summer). */
export function israelOffsetHours(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((local - Math.floor(at.getTime() / 60000) * 60000) / HOUR);
}

/** The deadline for a plan week (`YYYY-MM-DD`, a Sunday): the Saturday before, 20:00 Israel. */
export function planDeadline(planWeekStart: string): Date {
  const [y, m, d] = planWeekStart.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d - 1, PLAN_DEADLINE_HOUR - 2));
  const off = israelOffsetHours(guess);
  return new Date(Date.UTC(y, m - 1, d - 1, PLAN_DEADLINE_HOUR - off));
}

export type PlanPromise = 'ready' | 'open' | 'late';

/** Next week's plan: written and pushed → ready; missing before the deadline → open; after → late. */
export function planPromise(nextPlanWeekStart: string, hasPlan: boolean, now: Date): PlanPromise {
  if (hasPlan) return 'ready';
  return now.getTime() > planDeadline(nextPlanWeekStart).getTime() ? 'late' : 'open';
}

/**
 * Oldest unanswered trainee feedback, in hours. A report is answered by any coach reply
 * (feedback row or thread message) at or after it. Null = nothing waiting.
 */
export function oldestUnansweredHours(
  reportsAt: Array<string | Date>,
  repliesAt: Array<string | Date>,
  now: Date,
): number | null {
  const lastReply = Math.max(-Infinity, ...repliesAt.map((r) => new Date(r).getTime()));
  const waiting = reportsAt.map((r) => new Date(r).getTime()).filter((t) => t > lastReply);
  if (!waiting.length) return null;
  return (now.getTime() - Math.min(...waiting)) / HOUR;
}

export function replyBroken(waitingHours: number | null): boolean {
  return waitingHours != null && waitingHours > REPLY_SLA_HOURS;
}

/** Whole days since the coach last wrote; null = never. Never-contacted counts as broken. */
export function daysSinceContact(lastContactAt: string | Date | null, now: Date): number | null {
  if (!lastContactAt) return null;
  return Math.floor((now.getTime() - new Date(lastContactAt).getTime()) / DAY);
}

export function contactBroken(days: number | null): boolean {
  return days == null || days > CONTACT_SLA_DAYS;
}

/** Median of coach reply latencies, hours (the trainee's "usually replies in ~N h"). */
export function medianReplyHours(pairs: Array<{ reportAt: string | Date; replyAt: string | Date }>): number | null {
  const xs = pairs
    .map((p) => (new Date(p.replyAt).getTime() - new Date(p.reportAt).getTime()) / HOUR)
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export interface TraineePromiseInput {
  athleteId: string;
  coachIds: string[];
  paused: boolean;
  hasNextPlan: boolean;
  waitingHours: number | null;
  daysSinceContact: number | null;
}

export interface TraineePromises {
  athleteId: string;
  plan: PlanPromise;
  replyLate: boolean;
  contactLate: boolean;
}

export function traineePromises(t: TraineePromiseInput, nextPlanWeekStart: string, now: Date): TraineePromises {
  // A paused trainee owes no plan and needs no weekly contact; their feedback still gets answered.
  return {
    athleteId: t.athleteId,
    plan: t.paused ? 'ready' : planPromise(nextPlanWeekStart, t.hasNextPlan, now),
    replyLate: replyBroken(t.waitingHours),
    contactLate: !t.paused && contactBroken(t.daysSinceContact),
  };
}

export interface PromiseCounts {
  noNextPlan: number;
  replyLate: number;
  contactLate: number;
  total: number;
  /** Per coach id → count of broken promises among their trainees (shared trainees count for each). */
  byCoach: Record<string, number>;
}

/** The manager's "פספוסי שירות" and the coach's flag counts — one summary for both. */
export function countPromises(rows: Array<TraineePromises & { coachIds: string[] }>): PromiseCounts {
  const c: PromiseCounts = { noNextPlan: 0, replyLate: 0, contactLate: 0, total: 0, byCoach: {} };
  for (const r of rows) {
    const n = (r.plan !== 'ready' ? 1 : 0) + (r.replyLate ? 1 : 0) + (r.contactLate ? 1 : 0);
    if (r.plan !== 'ready') c.noNextPlan++;
    if (r.replyLate) c.replyLate++;
    if (r.contactLate) c.contactLate++;
    c.total += n;
    if (n) for (const id of r.coachIds) c.byCoach[id] = (c.byCoach[id] || 0) + n;
  }
  return c;
}
