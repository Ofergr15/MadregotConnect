// When to ask a runner "how was it?" — one rule set, server-side
// (design/feedback-prototype/NOTES.md, decisions 2026-11-21).
//
//   | Run                         | Push                 | Card in פיד/השבוע       |
//   | Quality                     | yes                  | full 1–10 row           |
//   | Long ≥ 18 km                | yes                  | full row                |
//   | Other long                  | no                   | full row                |
//   | Easy                        | never                | quiet line, 1 in 4      |
//   | Unplanned / extra           | never                | nothing                 |
//
// Push guards: at most one feedback push per Israel day; two skips in a row → no
// feedback push for 7 days (cards still show); no push 22:00–07:00 Israel; nothing
// at all to a runner who is injured or paused. Pure — the cron/sync caller hands in
// the history.

export type PlannedKind = 'quality' | 'long' | 'easy' | 'other';
export type PromptMode = 'none' | 'quiet' | 'card';

export const LONG_PUSH_KM = 18;
export const EASY_SAMPLE_EVERY = 4;
export const SKIPS_TO_MUTE = 2;
export const MUTE_DAYS = 7;
export const SKIP_AFTER_HOURS = 24;
export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 7;

export interface PromptRun {
  activityId: string;
  distanceKm: number;
}

export interface PromptPlanDay {
  /** null = nothing planned that day (an extra run). */
  kind: PlannedKind | null;
}

/** One earlier evaluation, newest first or any order — the rules sort it. */
export interface PromptHistoryRow {
  createdAt: string;
  mode: PromptMode;
  plannedKind: PlannedKind | null;
  pushed: boolean;
  /** Israel calendar date the push went out, if it did. */
  pushedOn?: string | null;
  answeredAt?: string | null;
  dismissedAt?: string | null;
}

export interface PromptContext {
  now: Date;
  /** Israel wall clock of `now`. */
  israelHour: number;
  israelDate: string;
  availability: 'active' | 'injured' | 'paused';
}

export interface PromptDecision {
  mode: PromptMode;
  push: boolean;
  reason:
    | 'unavailable' | 'unplanned' | 'quality' | 'long_push' | 'long'
    | 'easy_sampled' | 'easy_skipped' | 'other';
  /** Why a push that the run qualifies for was held back. */
  held?: 'daily_cap' | 'muted' | 'quiet_hours';
}

/** Was this pushed prompt skipped: dismissed, or unanswered after 24 h? */
export function wasSkipped(row: PromptHistoryRow, now: Date): boolean {
  if (!row.pushed || row.answeredAt) return false;
  if (row.dismissedAt) return true;
  return now.getTime() - new Date(row.createdAt).getTime() >= SKIP_AFTER_HOURS * 3600_000;
}

/** Until when feedback pushes are muted, or null. */
export function mutedUntil(history: PromptHistoryRow[], now: Date): Date | null {
  const pushed = history.filter((h) => h.pushed).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (pushed.length < SKIPS_TO_MUTE) return null;
  const lastTwo = pushed.slice(0, SKIPS_TO_MUTE);
  if (!lastTwo.every((h) => wasSkipped(h, now))) return null;
  const newest = lastTwo[0];
  const skippedAt = newest.dismissedAt
    ? new Date(newest.dismissedAt)
    : new Date(new Date(newest.createdAt).getTime() + SKIP_AFTER_HOURS * 3600_000);
  const until = new Date(skippedAt.getTime() + MUTE_DAYS * 86400_000);
  return until > now ? until : null;
}

export function inQuietHours(hour: number): boolean {
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

/** 1 in 4 easy runs, by count: ask when the previous 3 easy evaluations didn't. */
export function easyIsSampled(history: PromptHistoryRow[]): boolean {
  const easy = history.filter((h) => h.plannedKind === 'easy').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sinceLastAsk = easy.findIndex((h) => h.mode !== 'none');
  const quietRun = sinceLastAsk === -1 ? easy.length : sinceLastAsk;
  return quietRun >= EASY_SAMPLE_EVERY - 1;
}

export function shouldAskFeedback(
  run: PromptRun,
  planDay: PromptPlanDay,
  history: PromptHistoryRow[],
  ctx: PromptContext,
): PromptDecision {
  if (ctx.availability !== 'active') return { mode: 'none', push: false, reason: 'unavailable' };
  if (!planDay.kind) return { mode: 'none', push: false, reason: 'unplanned' };

  let mode: PromptMode;
  let wantsPush: boolean;
  let reason: PromptDecision['reason'];
  switch (planDay.kind) {
    case 'quality':
      mode = 'card'; wantsPush = true; reason = 'quality'; break;
    case 'long':
      mode = 'card';
      wantsPush = run.distanceKm >= LONG_PUSH_KM;
      reason = wantsPush ? 'long_push' : 'long';
      break;
    case 'easy':
      if (!easyIsSampled(history)) return { mode: 'none', push: false, reason: 'easy_skipped' };
      return { mode: 'quiet', push: false, reason: 'easy_sampled' };
    default:
      return { mode: 'none', push: false, reason: 'other' };
  }
  if (!wantsPush) return { mode, push: false, reason };

  if (history.some((h) => h.pushed && h.pushedOn === ctx.israelDate)) return { mode, push: false, reason, held: 'daily_cap' };
  if (mutedUntil(history, ctx.now)) return { mode, push: false, reason, held: 'muted' };
  if (inQuietHours(ctx.israelHour)) return { mode, push: false, reason, held: 'quiet_hours' };
  return { mode, push: true, reason };
}

/** A plan day's kind from what the plan carries. */
export function plannedKindOf(sessionKind: 'easy' | 'quality' | 'other' | null, plannedKm: number, isLongDay: boolean): PlannedKind | null {
  if (sessionKind == null) return null;
  if (sessionKind === 'quality') return 'quality';
  if (isLongDay || plannedKm >= 16) return 'long';
  if (sessionKind === 'easy') return 'easy';
  return plannedKm > 0 ? 'easy' : 'other';
}
