/**
 * The runner's home, "היום" (mockup ~/.cache/madregot/today-mockup.html, approved by Ofer
 * 2026-10-19): the arithmetic behind it, kept apart from the screen so it can be tested.
 *
 *  - steadyTarget / rangeBar / runVerdict — after a steady run (one block: "50–70 דק׳
 *    4:40–5:15"), where the run landed inside its time and pace target.
 *  - lastWeekSummary — last week day by day, planned against run.
 *  - weeksSummary — the last eight full weeks, for the trend under it.
 */

import type { WorkoutStep } from '@/lib/ai/types';
import type { DailyDistance } from '@/lib/plans/workout-parsing';
import { flatSteps, packPace, type PaceRange } from '@/lib/plans/session-profile';
import { stepDurationSec } from '@/lib/workout-duration';
import { sessionsDone } from '@/lib/plans/next-session';
import type { PlanWeekRun } from '@/lib/athletes/plan-week';

const MAIN_SKIP = new Set(['warmup', 'cooldown', 'rest', 'recovery']);
/** A rep pace is part of the session when it carries this share of the busiest pace's time. */
const REP_SHARE = 0.15;

/** A run's own clock: "52:35", "2:51:27" — seconds count on a run, unlike a plan's "0:53". */
export function runClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

export interface SteadyTarget {
  /** What the block is measured in. */
  kind: 'time' | 'distance';
  /** Seconds or metres. */
  min: number;
  max: number;
  /** Seconds per km for the runner's pack, when the block has one. */
  pace: PaceRange | null;
}

/**
 * The pace of the session's work for pack `index` (0..2): across the reps when it has reps
 * ("3:20–3:40" for 1600s at 3:40 → 3:30 → 3:20), else the main block's (packPace). packPace
 * alone picks the longest paced step, which on Tuesday's 9 × 1600 is the 2 km jog home.
 */
export function sessionPace(steps: WorkoutStep[] | null | undefined, index: number): PaceRange | null {
  if (!steps?.length) return null;
  const of = (s: WorkoutStep): PaceRange | null => {
    const p = index === 0
      ? (s.targetPaceMinPerKm && s.targetPaceMaxPerKm ? { min: s.targetPaceMinPerKm, max: s.targetPaceMaxPerKm } : null)
      : index === 1 ? s.group2Pace ?? null : s.group3Pace ?? null;
    return p && p.min && p.max ? { min: Math.min(p.min, p.max), max: Math.max(p.min, p.max) } : null;
  };
  // The reps that carry the session. Strides before it ("interval", 45 s each) are intervals
  // too, so a pace counts only with a real share of the rep time — a few percent is a stride.
  const timed = flatSteps(steps).filter((s) => s.type === 'interval')
    .map((s) => ({ p: of(s), sec: stepDurationSec(s) })).filter((x): x is { p: PaceRange; sec: number } => !!x.p && x.sec > 0);
  const byPace = new Map<string, { p: PaceRange; sec: number }>();
  for (const x of timed) {
    const k = `${x.p.min}-${x.p.max}`;
    byPace.set(k, { p: x.p, sec: (byPace.get(k)?.sec ?? 0) + x.sec });
  }
  const top = Math.max(0, ...[...byPace.values()].map((x) => x.sec));
  const reps = [...byPace.values()].filter((x) => x.sec >= top * REP_SHARE).map((x) => x.p);
  if (reps.length) return { min: Math.min(...reps.map((p) => p.min)), max: Math.max(...reps.map((p) => p.max)) };
  return packPace(steps, index);
}

/**
 * Each pack's pace, 0..2. A week read in the runner's own lane (`/api/plans/week?lane=mine`)
 * carries that lane's paces in the first slot and no others — so they belong to the lane's
 * pack, not to pack 1. One-day sessions carry all three and pass through.
 */
export function packPaces(steps: WorkoutStep[] | null | undefined, lane: number | null | undefined): Array<PaceRange | null> {
  const all = [0, 1, 2].map((i) => sessionPace(steps, i));
  if (lane && lane >= 1 && lane <= 3 && !all[1] && !all[2]) return [0, 1, 2].map((i) => (i === lane - 1 ? all[0] : null));
  return all;
}

/**
 * The session's target when it is ONE steady block — an easy run, a long run at one
 * pace. Intervals, a progression or anything with repeats has no single target to draw
 * a bar against, so it returns null and the card says the plan's verdict instead.
 */
export function steadyTarget(steps: WorkoutStep[] | null | undefined, lane: number | null | undefined, packIndex: number): SteadyTarget | null {
  if (!steps?.length) return null;
  if (steps.some((s) => (s.repeatCount ?? 0) > 1 || s.repeatSteps?.length)) return null;
  const main = flatSteps(steps).filter((s) => !MAIN_SKIP.has(s.type));
  if (main.length !== 1) return null;
  const s = main[0];
  const lo = s.durationValue ?? 0;
  if (!lo || (s.durationType !== 'time' && s.durationType !== 'distance')) return null;
  const hi = Math.max(lo, s.durationMaxValue ?? lo);
  return { kind: s.durationType, min: lo, max: hi, pace: packPaces(steps, lane)[packIndex] };
}

export interface RangeBar {
  /** Where the target band starts and ends, and where the run is — percent of the track. */
  from: number;
  to: number;
  at: number;
  inside: boolean;
}

/**
 * A track twice as wide as the target, the target in the middle half, so the band reads
 * as "the target" and the dot as "you" — a bar that is all target says nothing.
 */
export function rangeBar(lo: number, hi: number, value: number): RangeBar {
  // A single-value target ("4:15") still gets a band, a tenth of the value wide.
  const [a, b] = hi > lo ? [lo, hi] : [lo - Math.max(lo * 0.05, 0.5), lo + Math.max(lo * 0.05, 0.5)];
  const span = b - a;
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - (a - span / 2)) / (span * 2)) * 100));
  return { from: pct(a), to: pct(b), at: pct(value), inside: value >= a && value <= b };
}

export type RunVerdict = 'onPlan' | 'fast' | 'slow' | 'short' | 'long';

/** One word on a steady run: inside both targets, or which way it missed. Pace first — it is what the coach set. */
export function runVerdict(t: SteadyTarget, run: { seconds: number; meters: number }): RunVerdict {
  if (t.pace && run.meters > 0) {
    const pace = run.seconds / (run.meters / 1000);
    if (pace < t.pace.min) return 'fast';
    if (pace > t.pace.max) return 'slow';
  }
  const v = t.kind === 'time' ? run.seconds : run.meters;
  if (v < t.min * 0.95) return 'short';
  if (v > t.max * 1.05) return 'long';
  return 'onPlan';
}

export interface LastWeekDay {
  dayOfWeek: number;
  planned: number;
  km: number;
  /** Run well under what was planned (or not run) on a day that had a plan. */
  missed: boolean;
}

export interface LastWeekSummary {
  km: number;
  plannedKm: number;
  /** Run against planned, 0..100+, null with no plan. */
  pct: number | null;
  sessionsPlanned: number;
  sessionsDone: number;
  days: LastWeekDay[];
  /** The longest single run of the week. */
  longest: { dayOfWeek: number; km: number; seconds: number } | null;
}

/** Under this share of the planned kilometres a day reads as dropped, not shortened. */
export const MISSED_SHARE = 0.6;

const r1 = (n: number) => Math.round(n * 10) / 10;

export function lastWeekSummary(plan: DailyDistance[] | null | undefined, dayKm: number[], dayRuns: PlanWeekRun[][]): LastWeekSummary {
  let sessionsPlanned = 0;
  let done = 0;
  const days: LastWeekDay[] = Array.from({ length: 7 }, (_, d) => {
    const p = plan?.find((x) => x.dayOfWeek === d);
    const required = (p?.sessions ?? []).filter((s) => !s.optional && s.max > 0);
    const planned = p ? p.requiredMin : 0;
    const km = dayKm[d] ?? 0;
    sessionsPlanned += required.length;
    done += sessionsDone(required.map((s) => ({ kmMin: s.min })), (dayRuns[d] ?? []).map((r) => r.km));
    return { dayOfWeek: d, planned: r1(planned), km: r1(km), missed: planned > 0 && km < planned * MISSED_SHARE };
  });
  let longest: LastWeekSummary['longest'] = null;
  dayRuns.forEach((runs, d) => runs.forEach((r) => {
    if (!longest || r.km > longest.km) longest = { dayOfWeek: d, km: r.km, seconds: r.seconds };
  }));
  const km = r1(days.reduce((s, x) => s + x.km, 0));
  const plannedKm = r1(days.reduce((s, x) => s + x.planned, 0));
  return { km, plannedKm, pct: plannedKm > 0 ? Math.round((km / plannedKm) * 100) : null, sessionsPlanned, sessionsDone: done, days, longest };
}

export interface WeeksSummary {
  /** The last eight FULL weeks, oldest first; the last one is last week. */
  weeks: Array<{ weekStart: string; km: number }>;
  /** Mean of the full weeks before last week (up to seven). */
  avg: number;
  /** Last week against the week before it. */
  delta: number | null;
  /** Last week is the biggest of the eight. */
  biggest: boolean;
  /** Last week as a multiple of the average, one decimal. */
  ratio: number | null;
}

/** `weeks` is PlanWeekStats.weeks: oldest first, this (unfinished) week last. */
export function weeksSummary(weeks: Array<{ weekStart: string; km: number }>): WeeksSummary | null {
  const full = weeks.slice(0, -1).slice(-8);
  if (full.length < 2) return null;
  const last = full[full.length - 1].km;
  const before = full.slice(0, -1);
  const avg = Math.round(before.reduce((s, w) => s + w.km, 0) / before.length);
  return {
    weeks: full,
    avg,
    delta: Math.round(last - full[full.length - 2].km),
    biggest: last > 0 && before.every((w) => w.km < last),
    ratio: avg > 0 ? Math.round((last / avg) * 10) / 10 : null,
  };
}
