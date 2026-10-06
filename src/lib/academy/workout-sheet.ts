// The plan-vs-actual sheet, built from one graded workout.
//
// Pure: the route hands in the adherence row (with its server-only `detail`), the
// tolerances, the activity's few display fields and the coach's feedback, and gets
// back the small payload the sheet draws. Everything the sheet SAYS — which pace
// card, which chart, which steps count as off-plan, what the badge reads — is
// decided here, by the same pace rule the home's rows use (pace-verdict.ts).
//
// Payload discipline: the stored laps never leave the server. The chart gets one
// pace per rep or per kilometre and nothing else; the steps list gets one line per
// paced step.

import type { AdherenceTolerances } from './adherence';
import type { WorkoutAdherenceRow } from './report';
import { flattenPlannedSteps, type PlannedSegment } from './segments';
import { workPaceOf } from './work-pace';
import {
  amountVerdict, paceVerdict, type AmountVerdict, type PaceKind, type PaceVerdict,
} from './pace-verdict';
import { rowStatus, type RowStatus } from './trainee-home';

export interface SheetPoint {
  label: string;
  pace: number;
  kind: PaceKind;
}

export interface SheetStep {
  label: string;
  plannedMin: number;
  plannedMax: number;
  actual: number;
  verdict: PaceVerdict;
}

export interface WorkoutSheet {
  date: string;
  name: string;
  activityId: string | null;
  /** "6:12", the run's own wall clock. */
  startClock: string | null;
  locationName: string | null;
  status: RowStatus;
  /** The corner badge: accuracy when done, % of the distance when partly done. */
  badge: { value: number; kind: 'accuracy' | 'plan' } | null;
  distance: { actualM: number | null; plannedMinM: number; plannedMaxM: number; verdict: AmountVerdict | null };
  pace: {
    label: string;
    actual: number | null;
    targetMin: number;
    targetMax: number;
    verdict: PaceVerdict | null;
  } | null;
  time: { actualSec: number | null; plannedSec: number; estimated: boolean; verdict: AmountVerdict | null } | null;
  chart: {
    mode: 'reps' | 'km';
    /** The green band: the planned target widened by the tolerance, sec/km. */
    bandMin: number;
    bandMax: number;
    /** The planned target's mid-point — the dashed line. */
    target: number;
    points: SheetPoint[];
  } | null;
  /** Every paced step that was run; the sheet shows the off-plan ones first. */
  steps: SheetStep[];
  route: Array<{ lat: number; lng: number }> | null;
  feedback: { text: string; mentorName: string | null } | null;
  toleranceSec: number;
}

/** Laps shorter than this are a lap-button stub, not a kilometre. */
const MIN_KM_LAP_M = 300;
/** A long run's chart stops being readable past this many dots. */
const MAX_POINTS = 32;

/** "2 ק״מ" · "800 מ׳" · "3 דק׳" — the Hebrew of segments.ts's `lengthLabel`. */
export function lengthHe(distanceM?: number | null, durationSec?: number | null): string {
  if (distanceM && distanceM > 0) {
    if (distanceM >= 1000) {
      const km = distanceM / 1000;
      return `${Number.isInteger(km) ? km : km.toFixed(1)} ק״מ`;
    }
    return `${Math.round(distanceM)} מ׳`;
  }
  if (durationSec && durationSec > 0) {
    const sec = Math.round(durationSec);
    if (sec < 60) return `${sec} שנ׳`;
    if (sec % 60) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} דק׳`;
    return `${sec / 60} דק׳`;
  }
  return '';
}

function stepLabel(seg: PlannedSegment | undefined, type: string, repNumber: number): string {
  const length = lengthHe(seg?.distanceM, seg?.durationSec);
  const withLength = (word: string) => (length ? `${word} ${length}` : word);
  if (type === 'warmup') return withLength('חימום');
  if (type === 'cooldown') return withLength('שחרור');
  if (type === 'interval') return `חזרה ${repNumber}`;
  return withLength('ריצה');
}

export function buildWorkoutSheet(input: {
  row: WorkoutAdherenceRow;
  tolerances: AdherenceTolerances;
  today: string;
  activity: {
    startClock: string | null;
    locationName: string | null;
    route: Array<{ lat: number; lng: number }> | null;
  } | null;
  feedback: { text: string; mentorName: string | null } | null;
}): WorkoutSheet {
  const { row, tolerances } = input;
  const detail = row.detail;
  const verdict = detail?.verdict ?? null;
  const tol = tolerances.paceSec;

  const status = rowStatus({
    date: row.date,
    today: input.today,
    completed: row.completed,
    distanceStatus: row.distance.status,
    distancePct: row.distance.pct,
    score: row.execution?.score ?? null,
  });

  const badge: WorkoutSheet['badge'] = status.kind === 'done' && status.score != null
    ? { value: status.score, kind: 'accuracy' }
    : status.kind === 'partial' ? { value: status.pct, kind: 'plan' } : null;

  const distance = {
    actualM: row.distance.actual,
    plannedMinM: row.distance.plannedMin,
    plannedMaxM: row.distance.plannedMax,
    verdict: row.completed
      ? amountVerdict(row.distance.actual, row.distance.plannedMin, row.distance.plannedMax, tolerances.distance)
      : null,
  };

  const workPace = verdict ? workPaceOf(verdict, detail?.efforts ?? null) : null;
  // A structured session is read through its reps; a continuous one through its
  // average. `comparedMin` is the adherence engine's own "one pace covers this run".
  const structured = row.pace.comparedMin == null && row.pace.plannedMin != null;

  let pace: WorkoutSheet['pace'] = null;
  if (structured) {
    const min = workPace?.min ?? row.pace.plannedMin;
    const max = workPace?.max ?? row.pace.plannedMax ?? min;
    if (min != null && max != null) {
      const actual = workPace?.actual ?? null;
      pace = { label: 'קצב החזרות', actual, targetMin: min, targetMax: max, verdict: paceVerdict(actual, min, max, tol) };
    }
  } else {
    const min = row.pace.comparedMin ?? row.pace.plannedMin;
    const max = row.pace.comparedMax ?? row.pace.plannedMax ?? min;
    if (min != null && max != null) {
      const actual = row.pace.actual;
      pace = { label: 'קצב ממוצע', actual, targetMin: min, targetMax: max, verdict: paceVerdict(actual, min, max, tol) };
    }
  }

  const time: WorkoutSheet['time'] = row.duration.planned > 0
    ? {
      actualSec: row.duration.actual,
      plannedSec: row.duration.planned,
      estimated: row.duration.estimated,
      verdict: row.completed
        ? amountVerdict(row.duration.actual, row.duration.planned, row.duration.planned, tolerances.duration)
        : null,
    }
    : null;

  // ── The chart ──
  let chart: WorkoutSheet['chart'] = null;
  if (row.completed && detail && pace) {
    const bandMin = Math.min(pace.targetMin, pace.targetMax) - tol;
    const bandMax = Math.max(pace.targetMin, pace.targetMax) + tol;
    const target = Math.round((pace.targetMin + pace.targetMax) / 2);
    const judge = (p: number): PaceKind => paceVerdict(p, pace!.targetMin, pace!.targetMax, tol)?.kind ?? 'on';
    let points: SheetPoint[] = [];
    if (structured) {
      const reps = (verdict?.reps ?? []).filter((r) => r.graded && (r.type === 'interval' || r.type === 'active') && r.actualPace != null);
      const paces = reps.length
        ? reps.map((r) => r.actualPace as number)
        : ((detail.efforts?.requirements ?? []).find((q) => q.verifiable && q.paces.length)?.paces ?? []);
      points = paces.map((p, i) => ({ label: String(i + 1), pace: Math.round(p), kind: judge(p) }));
    } else {
      const laps = detail.laps.filter((l) => l.distance >= MIN_KM_LAP_M);
      points = laps.map((l, i) => {
        const p = l.averagePace ?? (l.distance > 0 ? l.duration / (l.distance / 1000) : 0);
        return { label: i === 0 ? 'ק״מ 1' : String(i + 1), pace: Math.round(p), kind: judge(p) };
      }).filter((p) => p.pace > 0);
    }
    if (points.length > MAX_POINTS) points = points.slice(0, MAX_POINTS);
    if (points.length >= 2) {
      chart = { mode: structured ? 'reps' : 'km', bandMin, bandMax, target, points };
    }
  }

  // ── The steps ──
  const steps: SheetStep[] = [];
  if (row.completed && detail && verdict?.repsAligned) {
    const planned = flattenPlannedSteps(detail.workout);
    let repNumber = 0;
    for (const rep of verdict.reps) {
      if (rep.type === 'interval') repNumber += 1;
      if (!rep.graded || rep.actualPace == null || rep.plannedPaceMin == null) continue;
      const max = rep.plannedPaceMax ?? rep.plannedPaceMin;
      const v = paceVerdict(rep.actualPace, rep.plannedPaceMin, max, tol);
      if (!v) continue;
      steps.push({
        label: stepLabel(planned[rep.index], rep.type, repNumber),
        plannedMin: rep.plannedPaceMin,
        plannedMax: max,
        actual: Math.round(rep.actualPace),
        verdict: v,
      });
    }
  }

  return {
    date: row.date,
    name: row.name,
    activityId: row.actual?.id ?? null,
    startClock: input.activity?.startClock ?? null,
    locationName: input.activity?.locationName ?? null,
    status,
    badge,
    distance,
    pace,
    time,
    chart,
    steps,
    route: row.completed ? input.activity?.route ?? null : null,
    feedback: input.feedback,
    toleranceSec: tol,
  };
}
