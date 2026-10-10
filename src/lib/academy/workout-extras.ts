// What screens 4, 5 and 6 of the trainee experience add to the plan-vs-actual sheet
// (mockup trainee-experience-v2): before the run, the ⚡ it will cost, the range each work
// step carries on the watch and why the pace is what it is; after it, the one-line
// verdict, the plan/done/diff table, every rep against its watch range, a real personal
// record, and the watch's own self-evaluation to prefill "איך הרגשת?".
//
// Pure: GET /api/academy/workout hands in the graded row, the sheet it already built, the
// tests and the few activity fields, and gets back the small payload the screens draw.
// Keys and numbers only, never Hebrew.

import type { WorkoutStep } from '@/lib/ai/types';
import { computeDistanceBests, filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { planEstimateOptions } from '@/lib/plans/step-estimate';
import type { WorkoutAdherenceRow } from './report';
import type { WorkoutSheet } from './workout-sheet';
import { plannedLoad, plannedParts, thresholdOn, type LoadPart, type TestPoint } from './load';
import { watchRange } from './watch-range';

export interface WatchStep {
  /** The plan step's type (a repeat reports its work step's). */
  type: WorkoutStep['type'];
  /** A work step — reps, tempo, threshold. Only these print a watch range (mockup 4). */
  work: boolean;
  watchRange: { min: number; max: number } | null;
}

export type TableKey = 'distance' | 'time' | 'pace' | 'hr' | 'load';
export type Tone = 'good' | 'warn' | 'muted';

export interface DoneRow {
  key: TableKey;
  /** Metres / seconds / sec per km / bpm / load. Null = nothing planned for it. */
  planned: number | null;
  done: number;
  /** Signed done − planned in the row's unit; for pace, planned − done (faster = positive). */
  diff: number | null;
  tone: Tone;
}

export type VerdictKey = 'onPlan' | 'onPlanFast' | 'onPlanSlow' | 'fast' | 'slow' | 'short' | 'long' | 'done';

export interface WorkoutDone {
  verdictKey: VerdictKey;
  verdictTone: 'good' | 'warn';
  /** "החזרות ב־4:01 במקום 4:05. 4 מתוך 5 בטווח." */
  detail: { actual: number | null; target: number | null; reps: boolean; inRange: number; of: number; lastFaster: boolean };
  table: DoneRow[];
  reps: Array<{ paceSec: number; tone: 'in' | 'fast' | 'slow' }>;
  band: { min: number; max: number } | null;
}

export interface WorkoutPr {
  bucket: string;
  meters: number;
  value: number;
  previous: number;
  previousDate: string;
}

export interface WorkoutExtras {
  expectedLoad: number | null;
  /** The planned ⚡ broken into the plan's steps, for the sheet opened before the run. */
  expectedParts: LoadPart[];
  steps: WatchStep[];
  why: { targetSec: number; thresholdSec: number; basisTestDate: string } | null;
  done: WorkoutDone | null;
  pr: WorkoutPr | null;
  feelPrefill: { feel: number | null; effort: number | null } | null;
  feedback: { feel: number | null; difficulty: number | null; pain: boolean | null } | null;
  /** What screen 6 posts to /api/workout-feedback and opens the map with. */
  activity: { id: string; garminId: number | null } | null;
}

const WORK_ZONES = new Set(['tempo', 'threshold', 'interval', 'sprint', 'marathon_pace']);
/** No zone stated: a pace within this share of threshold is work (tempo or faster). */
const WORK_PACE_SHARE = 1.12;

function paceOf(step: WorkoutStep): number | null {
  const a = Number(step.targetPaceMinPerKm) || 0;
  const b = Number(step.targetPaceMaxPerKm) || 0;
  if (a > 0 && b > 0) return (a + b) / 2;
  return a || b || null;
}

function isWorkStep(step: WorkoutStep, T: number | null): boolean {
  if (step.type === 'warmup' || step.type === 'cooldown' || step.type === 'recovery' || step.type === 'rest') return false;
  if (step.type === 'interval') return true;
  if (step.targetZone) return WORK_ZONES.has(step.targetZone);
  const pace = paceOf(step);
  return !!(T && pace && pace <= T * WORK_PACE_SHARE);
}

/** One entry per top-level plan step, in order; a repeat speaks for its work step. */
export function watchSteps(steps: WorkoutStep[] | null | undefined, T: number | null): WatchStep[] {
  return (steps ?? []).map((step) => {
    const leaf = step.repeatCount && step.repeatSteps?.length
      ? step.repeatSteps.find(s => s.type !== 'recovery' && s.type !== 'rest') ?? step.repeatSteps[0]
      : step;
    const work = isWorkStep(leaf, T) || (!!step.repeatCount && leaf.type !== 'recovery');
    return { type: leaf.type, work, watchRange: work ? watchRange(leaf, 'work') : null };
  });
}

/** Normalise the watch's self-evaluation the way ActivityDetailBody reads it: feel 0–4, effort 1–10. */
export function feelPrefillOf(act: { perceived_feel?: number | null; perceived_rpe?: number | null } | null): WorkoutExtras['feelPrefill'] {
  if (!act) return null;
  let feel = act.perceived_feel == null ? null : Number(act.perceived_feel);
  let effort = act.perceived_rpe == null ? null : Number(act.perceived_rpe);
  // A raw Garmin value (feel 0–100, rpe 10–100) that skipped the sync's division.
  if (feel != null && feel > 4) feel = feel / 25;
  if (effort != null && effort > 10) effort = effort / 10;
  feel = feel != null && Number.isFinite(feel) ? Math.min(4, Math.max(0, Math.round(feel))) : null;
  effort = effort != null && Number.isFinite(effort) ? Math.min(10, Math.max(1, Math.round(effort))) : null;
  return feel == null && effort == null ? null : { feel, effort };
}

/**
 * A personal record set on THIS run: for some PR bucket (lib/prs/pr-buckets — 5K and up,
 * the same table the profile shows), this run's best beats every other run in the window,
 * AND an earlier run in that bucket exists for it to have beaten. A first-ever 10K is not
 * a medal; it is a first.
 */
export function personalRecord(run: RunActivityRow & { id: string }, others: Array<RunActivityRow & { id: string }>): WorkoutPr | null {
  const mine = computeDistanceBests(filterQualifyingRuns([run]));
  const rest = filterQualifyingRuns(others.filter(o => o.id !== run.id));
  const earlier = computeDistanceBests(rest.filter(o => o.start_time < run.start_time));
  const all = computeDistanceBests(rest);
  for (let i = 0; i < mine.length; i++) {
    const m = mine[i];
    const prev = earlier[i];
    if (m.seconds == null || prev.seconds == null || !prev.date) continue;
    if (all[i].seconds != null && all[i].seconds! <= m.seconds) continue;
    if (m.seconds >= prev.seconds) continue;
    return { bucket: m.key, meters: m.meters, value: m.seconds, previous: prev.seconds, previousDate: prev.date.slice(0, 10) };
  }
  return null;
}

/** The plan/done/diff table, the verdict line and the reps chart. Null until the run is in. */
export function workoutDone(input: {
  row: WorkoutAdherenceRow;
  sheet: WorkoutSheet;
  steps: WatchStep[];
  expectedLoad: number | null;
  actualLoad: number | null;
  hr: { cap: number | null; actual: number | null };
}): WorkoutDone | null {
  const { row, sheet } = input;
  if (!row.completed || !row.actual) return null;
  const table: DoneRow[] = [];

  const plannedM = (row.distance.plannedMin + row.distance.plannedMax) / 2;
  const actualM = row.distance.actual ?? row.actual.distance;
  if (actualM > 0) {
    const kind = sheet.distance.verdict?.kind ?? 'on';
    table.push({
      key: 'distance',
      planned: plannedM > 0 ? Math.round(plannedM) : null,
      done: Math.round(actualM),
      diff: plannedM > 0 ? Math.round(actualM - plannedM) : null,
      tone: kind === 'less' ? 'warn' : 'good',
    });
  }
  const actualSec = sheet.time?.actualSec ?? row.duration.actual;
  if (actualSec && actualSec > 0) {
    const plannedSec = sheet.time?.plannedSec ?? (row.duration.planned || null);
    table.push({
      key: 'time',
      planned: plannedSec ? Math.round(plannedSec) : null,
      done: Math.round(actualSec),
      diff: plannedSec ? Math.round(actualSec - plannedSec) : null,
      tone: sheet.time?.verdict?.kind === 'less' ? 'warn' : 'good',
    });
  }
  const pace = sheet.pace;
  const target = pace ? Math.round((pace.targetMin + pace.targetMax) / 2) : null;
  if (pace && pace.actual != null && target) {
    table.push({
      key: 'pace',
      planned: target,
      done: Math.round(pace.actual),
      diff: target - Math.round(pace.actual),
      tone: pace.verdict?.kind === 'slow' ? 'warn' : 'good',
    });
  }
  if (input.hr.actual && input.hr.cap) {
    table.push({
      key: 'hr', planned: input.hr.cap, done: Math.round(input.hr.actual), diff: null,
      tone: input.hr.actual <= input.hr.cap ? 'good' : 'warn',
    });
  }
  if (input.actualLoad != null) {
    table.push({
      key: 'load',
      planned: input.expectedLoad,
      done: input.actualLoad,
      diff: input.expectedLoad != null ? input.actualLoad - input.expectedLoad : null,
      tone: 'muted',
    });
  }

  // ── Every rep against the range the watch was given ──
  const work = input.steps.find(s => s.work && s.watchRange);
  const band = work?.watchRange ?? (target ? watchRange({ targetPaceMinPerKm: target }, 'work') : null);
  const reps = sheet.chart?.mode === 'reps' && band
    ? sheet.chart.points.map(p => ({
      paceSec: p.pace,
      tone: (p.pace < band.min ? 'fast' : p.pace > band.max ? 'slow' : 'in') as 'in' | 'fast' | 'slow',
    }))
    : [];
  const inRange = reps.filter(r => r.tone === 'in').length;

  // ── The verdict line ──
  let verdictKey: VerdictKey = 'done';
  const distKind = sheet.distance.verdict?.kind;
  if (distKind === 'less') verdictKey = 'short';
  else if (pace?.verdict) {
    const k = pace.verdict.kind;
    if (k === 'fast') verdictKey = 'fast';
    else if (k === 'slow') verdictKey = 'slow';
    else if (pace.actual != null && target != null && pace.actual < target - 1) verdictKey = 'onPlanFast';
    else if (pace.actual != null && target != null && pace.actual > target + 1) verdictKey = 'onPlanSlow';
    else verdictKey = 'onPlan';
  } else if (distKind === 'more') verdictKey = 'long';
  else if (distKind === 'on') verdictKey = 'onPlan';

  return {
    verdictKey,
    verdictTone: verdictKey === 'short' || verdictKey === 'slow' || verdictKey === 'onPlanSlow' ? 'warn' : 'good',
    detail: {
      actual: pace?.actual != null ? Math.round(pace.actual) : null,
      target,
      reps: sheet.chart?.mode === 'reps',
      inRange,
      of: reps.length,
      lastFaster: reps.length > 0 && reps[reps.length - 1].tone === 'fast',
    },
    table: table.slice(0, 5),
    reps,
    band,
  };
}

/** Everything above for one workout. */
export function buildWorkoutExtras(input: {
  row: WorkoutAdherenceRow;
  sheet: WorkoutSheet;
  date: string;
  tests: TestPoint[];
  actualLoad: number | null;
  maxHr: number | null;
  activity: {
    id: string; garmin_activity_id?: number | null; perceived_feel?: number | null; perceived_rpe?: number | null; average_hr?: number | null;
  } | null;
  pr: WorkoutPr | null;
  ownFeedback: { feel?: number | null; difficulty?: number | null; pain?: boolean | null } | null;
}): WorkoutExtras {
  const { row, date } = input;
  const workout = row.detail?.workout ?? null;
  const steps = workout?.steps ?? [];
  const basis = thresholdOn(date, input.tests);
  const T = basis?.thresholdSec ?? null;
  const opts = workout ? planEstimateOptions([workout]) : {};
  const expected = T && steps.length ? plannedLoad(steps, T, opts) : 0;
  const expectedLoad = expected > 0 ? Math.round(expected) : null;
  const ws = watchSteps(steps, T);

  const plannedMin = row.pace.plannedMin;
  const plannedMax = row.pace.plannedMax ?? plannedMin;
  const targetSec = plannedMin != null && plannedMax != null ? Math.round((plannedMin + plannedMax) / 2) : null;

  // The HR cap: the plan's own ceiling in bpm, when a step states one as % of max HR.
  const capPct = steps.flatMap(s => (s.repeatSteps?.length ? s.repeatSteps : [s]))
    .map(s => Number(s.targetHrMaxPct) || 0).filter(v => v > 0);
  const cap = capPct.length && input.maxHr ? Math.round((Math.max(...capPct) / 100) * input.maxHr) : null;

  return {
    expectedLoad,
    expectedParts: T && steps.length ? plannedParts(steps, T, opts) : [],
    steps: ws,
    why: targetSec && basis ? { targetSec, thresholdSec: basis.thresholdSec, basisTestDate: basis.date } : null,
    done: workoutDone({
      row,
      sheet: input.sheet,
      steps: ws,
      expectedLoad,
      actualLoad: input.actualLoad,
      hr: { cap, actual: input.activity?.average_hr ?? row.actual?.averageHr ?? null },
    }),
    pr: input.pr,
    feelPrefill: feelPrefillOf(input.activity),
    feedback: input.ownFeedback
      ? { feel: input.ownFeedback.feel ?? null, difficulty: input.ownFeedback.difficulty ?? null, pain: input.ownFeedback.pain ?? null }
      : null,
    activity: input.activity ? { id: input.activity.id, garminId: input.activity.garmin_activity_id ?? null } : null,
  };
}

/** GET /api/academy/workout's answer: the sheet, and — when they could be read — the extras. */
export type WorkoutResponse = { sheet: WorkoutSheet } & Partial<WorkoutExtras>;
