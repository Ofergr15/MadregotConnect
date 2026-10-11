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
import type { RunActivityRow } from '@/lib/prs/pr-buckets';
import { recordOn, type RecordRunLike } from './records';
import { planEstimateOptions } from '@/lib/plans/step-estimate';
import type { WorkoutAdherenceRow } from './report';
import type { WorkoutSheet } from './workout-sheet';
import { plannedLoad, plannedParts, restateOptions, restateSteps, thresholdOn, type LoadPart, type TestPoint } from './load';
import { absoluteToLibrary, bookTotals, fromLibrarySteps } from './book-steps';
import type { PlanBasis } from './plan-basis';
import { watchRange, watchRangeKind } from './watch-range';

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
  /** The run carries no ⚡: no test to price its pace and no heart rate to estimate it. Said on 5. */
  noLoad?: boolean;
}

export interface WorkoutPr {
  bucket: string;
  meters: number;
  value: number;
  previous: number;
  previousDate: string;
  /** The rep that set a 1 km record (1-based). */
  rep?: number;
}

export interface WorkoutExtras {
  expectedLoad: number | null;
  /** The session's km and minutes as the home card sizes it (the book's totals) — its "כ־51 דק׳". */
  planTotals: { distanceM: number; durationSec: number } | null;
  /** The planned ⚡ broken into the plan's steps, for the sheet opened before the run. */
  expectedParts: LoadPart[];
  steps: WatchStep[];
  why: { targetSec: number; thresholdSec: number; basisTestDate: string } | null;
  done: WorkoutDone | null;
  pr: WorkoutPr | null;
  feelPrefill: { feel: number | null; effort: number | null } | null;
  feedback: { feel: number | null; difficulty: number | null; pain: boolean | null } | null;
  /** What screen 6 posts to /api/workout-feedback and opens the map with. */
  activity: { id: string; garminId: number | null; lapsWhy?: LapsWhy | null } | null;
}

/**
 * Why a done run has no laps to tabulate (screen 5's "הקפות" tab), from where it came:
 * a manual entry has none; a Strava run's laps arrive after the run (or never); a watch
 * run with one lap (or none) is a watch whose Auto Lap is off. Null when it has laps.
 */
export type LapsWhy = 'manual' | 'stravaPending' | 'autoLapOff' | 'unknown';

export function lapsWhy(act: { source?: string | null; laps?: unknown; splits?: unknown } | null | undefined): LapsWhy | null {
  if (!act) return null;
  const laps = Array.isArray(act.laps) ? act.laps : null;
  const splits = Array.isArray(act.splits) ? act.splits : null;
  if ((laps && laps.length > 1) || (splits && splits.length > 1)) return null;
  const source = String(act.source ?? '');
  if (source === 'manual') return 'manual';
  if (source === 'strava') return act.laps == null ? 'stravaPending' : 'autoLapOff';
  if (source === 'garmin' || source === 'apple') return 'autoLapOff';
  return 'unknown';
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
    // The range the converter wrote for this step (its own work-or-easy rule), so the screen
    // prints what the watch holds.
    return { type: leaf.type, work, watchRange: work ? watchRange(leaf, watchRangeKind(leaf, !!step.repeatCount)) : null };
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
 * A personal record set on THIS run — lib/academy/records.ts `recordOn`, the one rule the
 * week row's 🏅 and the coach's readiness line use too: the fastest kilometre inside the
 * run (a rep: "החזרה החמישית") or a PR bucket of 5K and up, beating every earlier run and
 * not beaten since.
 */
export function personalRecord(run: RunActivityRow & { id: string }, others: Array<RunActivityRow & { id: string }>): WorkoutPr | null {
  return recordOn(run as RecordRunLike & { id: string }, others as Array<RecordRunLike & { id: string }>);
}

/**
 * The medal numbers its rep the way the reps chart right above it does: when the chart has
 * the reps, the record's rep is the chart's bar of that pace (one second either way). A
 * record no chart bar holds keeps the laps' own count.
 */
export function medalRep(pr: WorkoutPr | null, done: WorkoutDone | null): WorkoutPr | null {
  if (!pr || pr.bucket !== '1k' || !done?.reps.length) return pr;
  const i = done.reps.findIndex(r => Math.abs(r.paceSec - pr.value) <= 1);
  return i >= 0 ? { ...pr, rep: i + 1 } : pr;
}

/** The plan/done/diff table, the verdict line and the reps chart. Null until the run is in. */
export function workoutDone(input: {
  row: WorkoutAdherenceRow;
  sheet: WorkoutSheet;
  steps: WatchStep[];
  expectedLoad: number | null;
  actualLoad: number | null;
  hr: { cap: number | null; actual: number | null };
  /**
   * The session's size as the home card and screen 4 give it (book-steps bookTotals) — the
   * "כ־51 דק׳" — so the plan column says the same. Else the grade's.
   */
  planTotals?: { distanceM: number; durationSec: number } | null;
}): WorkoutDone | null {
  const { row, sheet } = input;
  if (!row.completed || !row.actual) return null;
  const table: DoneRow[] = [];

  const plannedM = input.planTotals?.distanceM || (row.distance.plannedMin + row.distance.plannedMax) / 2;
  const actualM = row.distance.actual ?? row.actual.distance;
  if (actualM > 0) {
    const kind = sheet.distance.verdict?.kind ?? 'on';
    // The difference of the two figures AS PRINTED (one decimal of a km): 10.3 against 10.3
    // is no difference, whatever the metres under them say.
    const tenth = (m: number) => Math.round(m / 100) * 100;
    table.push({
      key: 'distance',
      planned: plannedM > 0 ? Math.round(plannedM) : null,
      done: Math.round(actualM),
      diff: plannedM > 0 ? tenth(actualM) - tenth(plannedM) : null,
      tone: kind === 'less' ? 'warn' : 'good',
    });
  }
  const actualSec = sheet.time?.actualSec ?? row.duration.actual;
  if (actualSec && actualSec > 0) {
    const plannedSec = input.planTotals?.durationSec || sheet.time?.plannedSec || row.duration.planned || null;
    // Coloured only when time was a prescription (a "40 דק׳" run) and the grade says it was
    // missed or overrun; a km session's minutes are an estimate, and slower or faster than it
    // is the pace row's to say.
    const kind = sheet.time && !sheet.time.estimated ? sheet.time.verdict?.kind : null;
    table.push({
      key: 'time',
      planned: plannedSec ? Math.round(plannedSec) : null,
      done: Math.round(actualSec),
      diff: plannedSec ? Math.round(actualSec) - Math.round(plannedSec) : null,
      tone: kind === 'less' || kind === 'more' ? 'warn' : kind === 'on' ? 'good' : 'muted',
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
    ...(input.actualLoad == null ? { noLoad: true } : {}),
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
  /**
   * Whose paces the plan's steps are in (lib/academy/plan-basis.ts): the trainee's own plan
   * as stored; a club week's lane paces restated by `scale`. Prices the ⚡, sets the watch
   * range in the paces screen 4 prints, and sizes the session as the home card does.
   */
  planBasis?: Pick<PlanBasis, 'referenceSec' | 'drawAtSec' | 'scale'> | null;
  actualLoad: number | null;
  maxHr: number | null;
  activity: {
    id: string; garmin_activity_id?: number | null; perceived_feel?: number | null; perceived_rpe?: number | null; average_hr?: number | null;
    source?: string | null; laps?: unknown; splits?: unknown;
  } | null;
  pr: WorkoutPr | null;
  ownFeedback: { feel?: number | null; difficulty?: number | null; pain?: boolean | null } | null;
}): WorkoutExtras {
  const { row, date } = input;
  const workout = row.detail?.workout ?? null;
  const scale = input.planBasis?.scale && input.planBasis.scale > 0 ? input.planBasis.scale : 1;
  const raw = workout?.steps ?? [];
  const steps = restateSteps(raw, scale);
  const basis = thresholdOn(date, input.tests);
  const T = basis?.thresholdSec ?? null;
  const opts = restateOptions(workout ? planEstimateOptions([workout]) : {}, scale);
  const expected = T && steps.length ? plannedLoad(steps, T, opts) : 0;
  const expectedLoad = expected > 0 ? Math.round(expected) : null;
  const ws = watchSteps(steps, T);
  // Sized exactly as the home card (trainee-today todayCard): the book's model at the
  // reference the steps were written for, drawn at the trainee's threshold.
  const ref = input.planBasis?.referenceSec ?? T ?? 300;
  const drawAt = input.planBasis?.drawAtSec ?? ref;
  const book = raw.length ? fromLibrarySteps(absoluteToLibrary(raw, ref).steps) : null;
  const planTotals = book ? bookTotals(book, drawAt) : null;

  const plannedMin = row.pace.plannedMin;
  const plannedMax = row.pace.plannedMax ?? plannedMin;
  const targetSec = plannedMin != null && plannedMax != null ? Math.round(((plannedMin + plannedMax) / 2) * scale) : null;

  // The HR cap: the plan's own ceiling in bpm, when a step states one as % of max HR.
  const capPct = steps.flatMap(s => (s.repeatSteps?.length ? s.repeatSteps : [s]))
    .map(s => Number(s.targetHrMaxPct) || 0).filter(v => v > 0);
  const cap = capPct.length && input.maxHr ? Math.round((Math.max(...capPct) / 100) * input.maxHr) : null;

  const done = workoutDone({
    row,
    sheet: input.sheet,
    steps: ws,
    expectedLoad,
    actualLoad: input.actualLoad,
    hr: { cap, actual: input.activity?.average_hr ?? row.actual?.averageHr ?? null },
    planTotals: planTotals && planTotals.durationSec > 0 ? { distanceM: planTotals.distanceM, durationSec: planTotals.durationSec } : null,
  });

  return {
    expectedLoad,
    planTotals: planTotals && planTotals.durationSec > 0 ? { distanceM: planTotals.distanceM, durationSec: planTotals.durationSec } : null,
    expectedParts: T && steps.length ? plannedParts(steps, T, opts) : [],
    steps: ws,
    why: targetSec && basis ? { targetSec, thresholdSec: basis.thresholdSec, basisTestDate: basis.date } : null,
    done,
    pr: medalRep(input.pr, done),
    feelPrefill: feelPrefillOf(input.activity),
    feedback: input.ownFeedback
      ? { feel: input.ownFeedback.feel ?? null, difficulty: input.ownFeedback.difficulty ?? null, pain: input.ownFeedback.pain ?? null }
      : null,
    activity: input.activity ? { id: input.activity.id, garminId: input.activity.garmin_activity_id ?? null, lapsWhy: lapsWhy(input.activity) } : null,
  };
}

/** GET /api/academy/workout's answer: the sheet, and — when they could be read — the extras. */
export type WorkoutResponse = { sheet: WorkoutSheet } & Partial<WorkoutExtras>;
