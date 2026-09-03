import { ParsedWorkout, WorkoutStep } from '../ai/types';

// ── Adherence engine ────────────────────────────────────────────────────────
// Pure functions that compare a coach's PLANNED workouts to what an academy
// athlete ACTUALLY did (synced Garmin/Strava activities). No DB access here so
// it can be unit-tested; the API route feeds it plain objects.
//
// Units: distances in METERS, durations in SECONDS, paces in SECONDS PER KM
// (smaller pace = faster) — matching athlete_activities and WorkoutStep.

export type MetricStatus = 'on_target' | 'under' | 'over' | 'unknown';
export type PaceStatus = 'on_target' | 'faster' | 'slower' | 'unknown';

export interface AdherenceTolerances {
  distance: number; // fraction, e.g. 0.15 = ±15%
  duration: number; // fraction
  paceSec: number;  // ± SECONDS per km, e.g. 5 → a 5:00 target is good from 4:55 to 5:05
}

export const DEFAULT_TOLERANCES: AdherenceTolerances = {
  distance: 0.15,
  duration: 0.15,
  paceSec: 5,
};

// What the athlete was supposed to do on a given day (derived from a ParsedWorkout).
export interface PlannedWorkout {
  date: string; // YYYY-MM-DD (athlete-local calendar day)
  name: string;
  /**
   * The plan's own deterministic key for this workout (see lib/plans/normalize-plan).
   * Present so a caller can hand `assessWeek` the attribution that
   * activity_plan_matches already holds instead of it re-guessing by date.
   */
  workoutKey?: string;
  distanceMin: number; // meters
  distanceMax: number; // meters
  durationSec: number; // estimated planned moving time
  paceMin?: number; // sec/km, fastest planned work pace
  paceMax?: number; // sec/km, slowest planned work pace
  /**
   * The only band a whole-run average pace may fairly be graded against: set when
   * one pace covers almost the entire session, undefined for a structured session
   * where a single average says nothing. `paceMin`/`paceMax` above stay the work
   * band — what the coach prescribed and what the UI shows. See
   * computeGradedPaceBand.
   */
  gradedPaceMin?: number;
  gradedPaceMax?: number;
  /**
   * True when `durationSec` had to invent a number — an open-ended ("Lap Button")
   * step, or a distance step with no pace to convert it. An estimate must not be
   * graded: see assessWorkout.
   */
  durationEstimated: boolean;
}

// A completed activity, already normalized to the athlete-local calendar day.
export interface ActualActivity {
  id: string;
  date: string; // YYYY-MM-DD
  distance: number; // meters
  duration: number; // seconds (total elapsed)
  movingDuration?: number | null; // seconds
  averagePace?: number | null; // sec/km
  activityType?: string;
}

export interface WorkoutAdherence {
  date: string;
  name: string;
  completed: boolean;
  planned: PlannedWorkout;
  actual: ActualActivity | null;
  distance: { status: MetricStatus; plannedMin: number; plannedMax: number; actual: number | null; pct: number | null };
  // `estimated` = the plan never stated a time, so `planned` is this engine's own
  // guess and `status` is forced to 'unknown' rather than graded.
  duration: { status: MetricStatus; planned: number; actual: number | null; pct: number | null; estimated: boolean };
  // `plannedMin`/`plannedMax` are the WORK band — what to show the athlete.
  // `comparedMin`/`comparedMax` are the band `status` was actually judged against
  // (the whole-session band when the session has non-work steps).
  pace: {
    status: PaceStatus;
    plannedMin: number | null;
    plannedMax: number | null;
    comparedMin: number | null;
    comparedMax: number | null;
    actual: number | null;
  };
  // 0..1 — fraction of computable metrics that were on target (0 if missed).
  score: number;
}

export interface WeekAdherence {
  plannedCount: number;
  completedCount: number;
  completionRate: number; // 0..1
  avgScore: number; // 0..1 across planned workouts
  workouts: WorkoutAdherence[];
}

// ── Planned-metric extraction ───────────────────────────────────────────────

const DEFAULT_PACE_MIN = 300; // 5:00/km fallback when a step has no pace
const DEFAULT_PACE_MAX = 360; // 6:00/km

// Distance in meters for one step (mirrors the estimator in the weekly dashboard
// route so planned distances stay consistent across the app).
export function computeStepDistance(step: WorkoutStep): { min: number; max: number } {
  if (step.repeatCount && step.repeatSteps) {
    let subMin = 0;
    let subMax = 0;
    for (const sub of step.repeatSteps) {
      const d = computeStepDistance(sub);
      subMin += d.min;
      subMax += d.max;
    }
    return { min: subMin * step.repeatCount, max: subMax * step.repeatCount };
  }

  if (step.durationType === 'distance' && step.durationValue) {
    return { min: step.durationValue, max: step.durationValue };
  }

  if (step.durationType === 'time' && step.durationValue) {
    const paceMin = step.targetPaceMinPerKm || DEFAULT_PACE_MIN;
    const paceMax = step.targetPaceMaxPerKm || DEFAULT_PACE_MAX;
    const timeSec = step.durationValue;
    const distMax = (timeSec / paceMin) * 1000; // faster pace → more distance
    const distMin = (timeSec / paceMax) * 1000;
    return { min: Math.round(distMin), max: Math.round(distMax) };
  }

  if (step.durationType === 'open' && step.targetPaceMinPerKm) {
    const pace = (step.targetPaceMinPerKm + (step.targetPaceMaxPerKm || step.targetPaceMinPerKm)) / 2;
    let estimatedSec = 0;
    if (step.type === 'warmup' || step.type === 'cooldown') estimatedSec = 10 * 60;
    else if (step.type === 'active' || step.type === 'interval') estimatedSec = 40 * 60;
    if (estimatedSec > 0) {
      const dist = (estimatedSec / pace) * 1000;
      return { min: Math.round(dist * 0.8), max: Math.round(dist * 1.2) };
    }
  }

  if (step.durationType === 'open' && (step.type === 'warmup' || step.type === 'cooldown')) {
    return { min: 1500, max: 2500 };
  }

  return { min: 0, max: 0 };
}

/**
 * Planned moving time in seconds for one step, and whether getting there
 * required inventing a number.
 *
 * `estimated` is the honesty flag. A "run 10 km at 5:00/km" step yields an exact
 * 3000 s. But an open-ended step ("Lap Button Press") or a distance with no pace
 * only yields a duration because this function falls back to DEFAULT_PACE_* or a
 * flat 10/40-minute guess — and grading a coach's plan against this engine's own
 * guess at ±15% is not a measurement, it's noise. Measured over 882 completed
 * production workouts, that comparison produced 393 'over' and 243 'under'
 * against only 246 'on_target'.
 */
function computeStepDuration(step: WorkoutStep): { sec: number; estimated: boolean } {
  if (step.repeatCount && step.repeatSteps) {
    let sub = 0;
    let estimated = false;
    for (const s of step.repeatSteps) {
      const d = computeStepDuration(s);
      sub += d.sec;
      estimated = estimated || d.estimated;
    }
    return { sec: sub * step.repeatCount, estimated };
  }
  if (step.durationType === 'time' && step.durationValue) {
    return { sec: step.durationValue, estimated: false };
  }
  if (step.durationType === 'distance' && step.durationValue) {
    const hasPace = Boolean(step.targetPaceMinPerKm);
    const paceMin = step.targetPaceMinPerKm || DEFAULT_PACE_MIN;
    const paceMax = step.targetPaceMaxPerKm || DEFAULT_PACE_MAX;
    const avgPace = (paceMin + paceMax) / 2; // sec/km
    return { sec: Math.round((step.durationValue / 1000) * avgPace), estimated: !hasPace };
  }
  if (step.durationType === 'open') {
    if (step.type === 'warmup' || step.type === 'cooldown') return { sec: 10 * 60, estimated: true };
    if (step.type === 'active' || step.type === 'interval') return { sec: 40 * 60, estimated: true };
  }
  return { sec: 0, estimated: false };
}

// Every leaf step, with repeats expanded in place so a set of 6×400 m counts six
// times towards a weighted average rather than once.
function flattenSteps(steps: WorkoutStep[]): WorkoutStep[] {
  const flat: WorkoutStep[] = [];
  const walk = (ss: WorkoutStep[], times: number) => {
    for (const s of ss) {
      if (s.repeatSteps && s.repeatSteps.length) {
        walk(s.repeatSteps, times * (s.repeatCount || 1));
      } else {
        for (let i = 0; i < times; i++) flat.push(s);
      }
    }
  };
  walk(steps, 1);
  return flat;
}

// Gather the planned "work" pace band (sec/km) across steps that carry a pace.
// Warmup/cooldown/rest/recovery are excluded when there are real work steps, so
// an interval session's band reflects the intervals, not the jog.
function computePaceBand(steps: WorkoutStep[]): { min?: number; max?: number } {
  const flat = flattenSteps(steps);

  const paced = flat.filter(s => s.targetType === 'pace' && s.targetPaceMinPerKm);
  const work = paced.filter(s => s.type === 'interval' || s.type === 'active');
  const pool = work.length ? work : paced;
  if (!pool.length) return {};

  let min = Infinity;
  let max = -Infinity;
  for (const s of pool) {
    const lo = s.targetPaceMinPerKm!;
    const hi = s.targetPaceMaxPerKm || s.targetPaceMinPerKm!;
    if (lo < min) min = lo;
    if (hi > max) max = hi;
  }
  return { min, max };
}

/** A single pace band must cover this much of the planned distance to be gradable. */
const SINGLE_PACE_COVERAGE = 0.9;

/**
 * The band an activity's *whole-run average pace* may legitimately be graded
 * against — and nothing when there isn't one.
 *
 * `assessPace` only ever receives `activity.average_pace`: one number for the
 * entire run. Comparing that to the work-only band from `computePaceBand` above
 * compares two different quantities. An athlete who jogs a 2 km warmup at 5:30 and
 * then nails 8×400 m at 4:00 has a whole-run average nowhere near 4:00, and ±5
 * s/km cannot absorb the difference: of 307 completed production interval sessions
 * graded that way, 139 were reported "slower than target" — athletes told they
 * missed a workout they actually hit.
 *
 * The fix is NOT to predict what the session average "should" have been. That was
 * tried and measured, and it is worse (209 of the same 307 came out 'slower'):
 * recovery jogs and drills carry no pace target, so any predicted average leaves
 * them out while the athlete's real average includes every slow metre of them.
 *
 * So: grade pace only when one band covers ≥90% of the planned distance — a
 * continuous easy/tempo/long run, where the average IS the prescription. For a
 * structured session, one average genuinely cannot answer "did you hit your
 * intervals"; that question is answered lap-by-lap by /api/academy/segments, and
 * the honest verdict here is 'unknown' (excluded from the score).
 */
function computeGradedPaceBand(steps: WorkoutStep[]): { min?: number; max?: number } {
  const flat = flattenSteps(steps);

  let totalMeters = 0;
  const byBand = new Map<string, { min: number; max: number; meters: number }>();

  for (const step of flat) {
    const d = computeStepDistance(step);
    const meters = (d.min + d.max) / 2;
    if (meters <= 0) continue;
    totalMeters += meters;
    if (step.targetType !== 'pace' || !step.targetPaceMinPerKm) continue;
    const min = step.targetPaceMinPerKm;
    const max = step.targetPaceMaxPerKm || step.targetPaceMinPerKm;
    const key = `${min}-${max}`;
    const entry = byBand.get(key) || { min, max, meters: 0 };
    entry.meters += meters;
    byBand.set(key, entry);
  }

  if (totalMeters <= 0) return {};
  for (const band of byBand.values()) {
    if (band.meters / totalMeters >= SINGLE_PACE_COVERAGE) return { min: band.min, max: band.max };
  }
  return {};
}

export function buildPlannedWorkout(workout: ParsedWorkout, date: string): PlannedWorkout {
  // Prefer coach-provided explicit distances (km) when present.
  let distanceMin = 0;
  let distanceMax = 0;
  if (workout.distanceMinKm) {
    distanceMin = workout.distanceMinKm * 1000;
    distanceMax = (workout.distanceMaxKm || workout.distanceMinKm) * 1000;
  } else {
    for (const step of workout.steps) {
      const d = computeStepDistance(step);
      distanceMin += d.min;
      distanceMax += d.max;
    }
  }

  let durationSec = 0;
  let durationEstimated = false;
  for (const step of workout.steps) {
    const d = computeStepDuration(step);
    durationSec += d.sec;
    durationEstimated = durationEstimated || d.estimated;
  }
  const band = computePaceBand(workout.steps);
  const gradedBand = computeGradedPaceBand(workout.steps);

  return {
    date,
    name: workout.name,
    workoutKey: workout.workoutKey,
    distanceMin: Math.round(distanceMin),
    distanceMax: Math.round(distanceMax),
    durationSec,
    // A workout with no timed step at all has nothing to grade either.
    durationEstimated: durationEstimated || durationSec <= 0,
    paceMin: band.min,
    paceMax: band.max,
    gradedPaceMin: gradedBand.min,
    gradedPaceMax: gradedBand.max,
  };
}

// ── Assessment ──────────────────────────────────────────────────────────────

function assessRange(actual: number | null, min: number, max: number, tol: number): MetricStatus {
  if (actual == null || max <= 0) return 'unknown';
  const lower = min * (1 - tol);
  const upper = max * (1 + tol);
  if (actual < lower) return 'under';
  if (actual > upper) return 'over';
  return 'on_target';
}

// Pace tolerance is ± SECONDS per km around the planned band. e.g. a 5:00 target
// with paceSec=5 is good from 4:55 (295s) to 5:05 (305s); 4:50 is too fast, 5:06 too slow.
export function assessPace(actual: number | null, min?: number, max?: number, paceSec = DEFAULT_TOLERANCES.paceSec): PaceStatus {
  if (actual == null || min == null || max == null) return 'unknown';
  const lower = min - paceSec; // faster bound (smaller number)
  const upper = max + paceSec; // slower bound
  if (actual < lower) return 'faster';
  if (actual > upper) return 'slower';
  return 'on_target';
}

export function assessWorkout(
  planned: PlannedWorkout,
  actual: ActualActivity | null,
  tol: AdherenceTolerances = DEFAULT_TOLERANCES
): WorkoutAdherence {
  const completed = actual != null;

  const distStatus = assessRange(actual?.distance ?? null, planned.distanceMin, planned.distanceMax, tol.distance);
  const actualDuration = actual ? (actual.movingDuration ?? actual.duration) : null;
  // Only grade time the coach actually prescribed — see PlannedWorkout.durationEstimated.
  const durStatus: MetricStatus = planned.durationEstimated
    ? 'unknown'
    : assessRange(actualDuration, planned.durationSec, planned.durationSec, tol.duration);

  // `actual.averagePace` is the average over the WHOLE run. No fallback to the
  // work band: that comparison is the bug computeGradedPaceBand exists to fix, so
  // a structured session stays 'unknown' here and is graded per segment instead.
  const comparedMin = planned.gradedPaceMin;
  const comparedMax = planned.gradedPaceMax;
  const paceStatus = assessPace(actual?.averagePace ?? null, comparedMin, comparedMax, tol.paceSec);

  // Score = fraction of computable metrics that landed on target. Missed = 0.
  let scored = 0;
  let onTarget = 0;
  if (completed) {
    if (distStatus !== 'unknown') { scored++; if (distStatus === 'on_target') onTarget++; }
    if (durStatus !== 'unknown') { scored++; if (durStatus === 'on_target') onTarget++; }
    if (paceStatus !== 'unknown') { scored++; if (paceStatus === 'on_target') onTarget++; }
  }
  const score = completed ? (scored ? onTarget / scored : 1) : 0;

  const distPct = actual && planned.distanceMax > 0
    ? actual.distance / ((planned.distanceMin + planned.distanceMax) / 2)
    : null;
  const durPct = actualDuration && planned.durationSec > 0
    ? actualDuration / planned.durationSec
    : null;

  return {
    date: planned.date,
    name: planned.name,
    completed,
    planned,
    actual,
    distance: { status: distStatus, plannedMin: planned.distanceMin, plannedMax: planned.distanceMax, actual: actual?.distance ?? null, pct: distPct },
    duration: { status: durStatus, planned: planned.durationSec, actual: actualDuration, pct: durPct, estimated: planned.durationEstimated },
    pace: {
      status: paceStatus,
      plannedMin: planned.paceMin ?? null,
      plannedMax: planned.paceMax ?? null,
      comparedMin: comparedMin ?? null,
      comparedMax: comparedMax ?? null,
      actual: actual?.averagePace ?? null,
    },
    score,
  };
}

// Pick the single activity on a date that best represents the planned workout:
// prefer the one closest to planned distance; if no planned distance, the longest.
function pickActivityForDay(planned: PlannedWorkout, sameDay: ActualActivity[]): ActualActivity | null {
  if (!sameDay.length) return null;
  if (sameDay.length === 1) return sameDay[0];
  const target = (planned.distanceMin + planned.distanceMax) / 2;
  if (target > 0) {
    return [...sameDay].sort((a, b) => Math.abs(a.distance - target) - Math.abs(b.distance - target))[0];
  }
  return [...sameDay].sort((a, b) => b.distance - a.distance)[0];
}

/**
 * `attribution` maps a workoutKey to the activity ids matched to it — normally
 * straight out of activity_plan_matches, so this engine grades exactly what
 * lib/plans/activity-matcher.ts attributed and what a coach manually overrode.
 *
 * It used to have no such input and paired purely by calendar date, which meant a
 * coach's manual correction changed nothing on the compliance screen, and a
 * session moved to the next day counted as missed. Days with no attribution still
 * fall back to the same-day pick, so an unmigrated activity_plan_matches (or an
 * athlete synced before matching ran) degrades to the old behaviour rather than
 * reporting an empty week.
 */
export function assessWeek(
  planned: PlannedWorkout[],
  activities: ActualActivity[],
  tol: AdherenceTolerances = DEFAULT_TOLERANCES,
  attribution?: Map<string, string[]>,
): WeekAdherence {
  const byDate = new Map<string, ActualActivity[]>();
  for (const a of activities) {
    const arr = byDate.get(a.date) || [];
    arr.push(a);
    byDate.set(a.date, arr);
  }
  const byId = new Map(activities.map(a => [a.id, a]));

  const used = new Set<string>();
  const attributed = new Map<PlannedWorkout, ActualActivity>();

  // Attributed workouts claim their activity first, so a fallback same-day pick
  // can never steal one the matcher had already assigned to another day's session.
  // activity_plan_matches is unique on (athlete, plan, workout_key), so a key maps
  // to at most one activity.
  if (attribution?.size) {
    for (const p of planned) {
      const activityId = p.workoutKey ? attribution.get(p.workoutKey)?.[0] : undefined;
      const activity = activityId ? byId.get(activityId) : undefined;
      if (!activity || used.has(activity.id)) continue;
      used.add(activity.id);
      attributed.set(p, activity);
    }
  }

  const workouts: WorkoutAdherence[] = planned.map(p => {
    const attributedActivity = attributed.get(p);
    if (attributedActivity) return assessWorkout(p, attributedActivity, tol);
    const sameDay = (byDate.get(p.date) || []).filter(a => !used.has(a.id));
    const match = pickActivityForDay(p, sameDay);
    if (match) used.add(match.id);
    return assessWorkout(p, match, tol);
  });

  const plannedCount = workouts.length;
  const completedCount = workouts.filter(w => w.completed).length;
  const avgScore = plannedCount ? workouts.reduce((acc, w) => acc + w.score, 0) / plannedCount : 0;

  return {
    plannedCount,
    completedCount,
    completionRate: plannedCount ? completedCount / plannedCount : 0,
    avgScore,
    workouts,
  };
}
