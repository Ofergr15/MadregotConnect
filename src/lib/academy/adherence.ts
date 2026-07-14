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
  distanceMin: number; // meters
  distanceMax: number; // meters
  durationSec: number; // estimated planned moving time
  paceMin?: number; // sec/km, fastest planned work pace
  paceMax?: number; // sec/km, slowest planned work pace
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
  duration: { status: MetricStatus; planned: number; actual: number | null; pct: number | null };
  pace: { status: PaceStatus; plannedMin: number | null; plannedMax: number | null; actual: number | null };
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

// Estimated moving time in seconds for one step.
function computeStepDuration(step: WorkoutStep): number {
  if (step.repeatCount && step.repeatSteps) {
    const sub = step.repeatSteps.reduce((acc, s) => acc + computeStepDuration(s), 0);
    return sub * step.repeatCount;
  }
  if (step.durationType === 'time' && step.durationValue) return step.durationValue;
  if (step.durationType === 'distance' && step.durationValue) {
    const paceMin = step.targetPaceMinPerKm || DEFAULT_PACE_MIN;
    const paceMax = step.targetPaceMaxPerKm || DEFAULT_PACE_MAX;
    const avgPace = (paceMin + paceMax) / 2; // sec/km
    return Math.round((step.durationValue / 1000) * avgPace);
  }
  if (step.durationType === 'open') {
    if (step.type === 'warmup' || step.type === 'cooldown') return 10 * 60;
    if (step.type === 'active' || step.type === 'interval') return 40 * 60;
  }
  return 0;
}

// Gather the planned "work" pace band (sec/km) across steps that carry a pace.
// Warmup/cooldown/rest/recovery are excluded when there are real work steps, so
// an interval session's band reflects the intervals, not the jog.
function computePaceBand(steps: WorkoutStep[]): { min?: number; max?: number } {
  const flat: WorkoutStep[] = [];
  const walk = (ss: WorkoutStep[]) => {
    for (const s of ss) {
      if (s.repeatSteps && s.repeatSteps.length) walk(s.repeatSteps);
      else flat.push(s);
    }
  };
  walk(steps);

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

  const durationSec = workout.steps.reduce((acc, s) => acc + computeStepDuration(s), 0);
  const band = computePaceBand(workout.steps);

  return {
    date,
    name: workout.name,
    distanceMin: Math.round(distanceMin),
    distanceMax: Math.round(distanceMax),
    durationSec,
    paceMin: band.min,
    paceMax: band.max,
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
  const durStatus = assessRange(actualDuration, planned.durationSec, planned.durationSec, tol.duration);
  const paceStatus = assessPace(actual?.averagePace ?? null, planned.paceMin, planned.paceMax, tol.paceSec);

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
    duration: { status: durStatus, planned: planned.durationSec, actual: actualDuration, pct: durPct },
    pace: { status: paceStatus, plannedMin: planned.paceMin ?? null, plannedMax: planned.paceMax ?? null, actual: actual?.averagePace ?? null },
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

export function assessWeek(
  planned: PlannedWorkout[],
  activities: ActualActivity[],
  tol: AdherenceTolerances = DEFAULT_TOLERANCES
): WeekAdherence {
  const byDate = new Map<string, ActualActivity[]>();
  for (const a of activities) {
    const arr = byDate.get(a.date) || [];
    arr.push(a);
    byDate.set(a.date, arr);
  }

  const used = new Set<string>();
  const workouts: WorkoutAdherence[] = planned.map(p => {
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
