import type { StoredLap } from '@/lib/garmin/laps';
import { isRepeatMarker, stepPaceBand, type ExecutedWorkout } from '@/lib/garmin/executed-workout';
import type { Lane } from '@/lib/academy/group-lane';

/**
 * THE SHARE CARD'S SEGMENTS, CUT BY THE WORKOUT RATHER THAN BY THE LAP BUTTON.
 *
 * The segments chart drew the watch's laps as they were stored, so the same session
 * came out two ways (2026-10-16, "ארוכה מיוחדת", 7×5 km): athletes with auto-lap off
 * got seven 5 km bars, and athletes with the default 1 km auto-lap got 35 one-km laps,
 * which `toLapBands` reads as "a plain run" and drops — their card fell back to km
 * splits. Eight of eleven watch-driven runs that day were the second kind.
 *
 * Every one of those 1 km laps is stamped with the step the watch was running
 * (`wktStepIndex`), so the session's real shape is recoverable exactly: consecutive
 * laps of one step are one segment. Two things make that more than a group-by:
 *
 *  - A repeat of a single step ("7 × 5 km" written as one step repeated) stamps every
 *    iteration with the SAME index, back to back. The step's own length from the
 *    workout the watch ran (`ExecutedWorkout`) cuts the group into its iterations.
 *  - Laps after the workout ended carry no index. They are kept, as free running.
 */

export type SegmentKind = 'warmup' | 'active' | 'recovery' | 'cooldown' | 'free';

export interface PlanSegment {
  m: number;
  /** sec/km over the segment. */
  pace: number;
  /** Time-weighted average heart rate, when the laps carry one. */
  hr?: number;
  kind: SegmentKind;
  /** The workout step the segment ran (`wktStepIndex`); absent on free running. */
  step?: number;
  /** The step's pace band at the athlete's lane, sec/km — see `withTargets`. */
  target?: { min: number; max: number };
}

/** A lap shorter than this is the watch closing a step a stride late, not running. */
const SLIVER_M = 10;
/** How far short of its planned length an iteration may close and still count as one. */
const ITERATION_SLACK = 0.03;

function kindOf(intensity: string | null | undefined): SegmentKind {
  switch ((intensity ?? '').toUpperCase()) {
    case 'WARMUP': return 'warmup';
    case 'COOLDOWN': return 'cooldown';
    case 'REST':
    case 'RECOVERY': return 'recovery';
    case 'ACTIVE':
    case 'INTERVAL': return 'active';
    default: return 'free';
  }
}

function merge(laps: StoredLap[], kind: SegmentKind, step?: number): PlanSegment | null {
  const m = laps.reduce((a, l) => a + l.distance, 0);
  const sec = laps.reduce((a, l) => a + l.duration, 0);
  if (m < SLIVER_M || sec <= 0) return null;
  const seg: PlanSegment = { m: Math.round(m), pace: Math.round(sec / (m / 1000)), kind };
  if (step != null) seg.step = step;
  const withHr = laps.filter(l => l.averageHR != null && l.averageHR > 0);
  const hrSec = withHr.reduce((a, l) => a + l.duration, 0);
  if (hrSec > 0) seg.hr = Math.round(withHr.reduce((a, l) => a + l.averageHR! * l.duration, 0) / hrSec);
  return seg;
}

/** Whether the laps were run from a workout on the watch, i.e. can be cut by step. */
export function isStepStamped(laps: StoredLap[]): boolean {
  return laps.some(l => l.wktStepIndex != null);
}

/**
 * One segment per executed step (per iteration, for a repeated single step).
 * Null when the laps are not stamped — there is no workout shape to recover.
 */
export function segmentsFromSteps(
  laps: StoredLap[],
  workout: ExecutedWorkout | null,
): PlanSegment[] | null {
  if (!isStepStamped(laps)) return null;
  const stepAt = new Map((workout?.steps ?? []).filter(s => !isRepeatMarker(s)).map(s => [s.stepIndex, s]));

  const out: PlanSegment[] = [];
  let run: StoredLap[] = [];
  let runKey: number | null | undefined;
  let runKind: SegmentKind = 'free';
  let doneM = 0;
  let doneSec = 0;
  const flush = () => {
    const seg = run.length ? merge(run, runKind, runKey ?? undefined) : null;
    if (seg) out.push(seg);
    run = [];
    doneM = 0;
    doneSec = 0;
  };

  for (const lap of laps) {
    const key = lap.wktStepIndex ?? null;
    if (key !== runKey) {
      flush();
      runKey = key;
      const step = key != null ? stepAt.get(key) : undefined;
      runKind = key == null ? 'free' : kindOf(step?.intensity ?? lap.intensityType);
    }
    run.push(lap);
    doneM += lap.distance;
    doneSec += lap.duration;
    // A step with a length closes when that length is covered: the next lap with the
    // same index is the next iteration of a repeat, not more of this one.
    const step = key != null ? stepAt.get(key) : undefined;
    const full = step?.distanceM != null
      ? doneM >= step.distanceM * (1 - ITERATION_SLACK)
      : step?.durationSec != null
        ? doneSec >= step.durationSec * (1 - ITERATION_SLACK)
        : false;
    if (full) flush();
  }
  flush();
  return out.length >= 2 ? out : null;
}

/**
 * The session's main set only — the work, without the warm-up, the strides and the
 * walks between them. "Main" is relative: an active segment at least a fifth of the
 * longest one. A 7 × 5 km keeps its seven 5 km (and drops 20-second strides); a
 * 6 × 400 keeps its six 400s and drops the rests. Falls back to everything when that
 * would leave fewer than two bars to draw.
 */
export function mainSet(segments: PlanSegment[]): PlanSegment[] {
  const active = segments.filter(s => s.kind === 'active');
  const longest = Math.max(0, ...active.map(s => s.m));
  const main = active.filter(s => s.m >= longest * 0.2);
  return main.length >= 2 ? main : segments;
}

/**
 * Each segment's target, read off the workout the watch ran at the athlete's lane —
 * the same `stepPaceBand` the accuracy ring grades with, so the card's ✓ and the
 * ring can't disagree about a block. A step with no pace asked of it (a walk, an
 * open warm-up, "מתגברת") gets none.
 */
export function withTargets(segments: PlanSegment[], workout: ExecutedWorkout | null, lane: Lane): PlanSegment[] {
  if (!workout) return segments;
  const stepAt = new Map(workout.steps.map(s => [s.stepIndex, s]));
  return segments.map(seg => {
    const step = seg.step != null ? stepAt.get(seg.step) : undefined;
    const band = step ? stepPaceBand(step, lane) : null;
    return band ? { ...seg, target: band } : seg;
  });
}

/** A block met its target: at or faster than the band's slow edge, with 3 s of grace. */
export function onTarget(seg: Pick<PlanSegment, 'pace' | 'target'>): boolean {
  return seg.target != null && seg.pace <= seg.target.max + 3;
}

/**
 * THE WORKOUT'S NAME AND SCORE, FOR THE CARD (mockup ~/.cache/madregot/open-tasks.html, Ofer
 * 2026-10-20). The watch names a planned run after the plan's day ("שלישי"), which says
 * nothing on a story; the card opens on what was run — "10 × 1600" — and offers "9/10 on
 * target" and the reps' average pace as numbers. The reps are the work blocks of the length
 * that repeats most, so a 2 km tempo out and back does not turn "10 × 1600" into "12 × …".
 */
export interface WorkoutHeadline { title: string; reps: number; hit: number | null; repPace: number }

export function workoutHeadline(segments: PlanSegment[] | null | undefined): WorkoutHeadline | null {
  const active = (segments ?? []).filter(s => s.kind === 'active' && s.m >= 100);
  const byLen = new Map<number, PlanSegment[]>();
  for (const s of active) {
    const k = s.m >= 1000 ? Math.round(s.m / 100) * 100 : Math.round(s.m / 50) * 50;
    byLen.set(k, [...(byLen.get(k) ?? []), s]);
  }
  const [len, full] = [...byLen].sort((a, b) => b[1].length - a[1].length || b[0] - a[0])[0] ?? [0, []];
  if (full.length < 2) return null;
  // The watch stopped inside the last rep (Ofer's 10 × 1600 of 2026-10-20 ended at 1,143 m):
  // it was still a rep of the session, so it is named and scored with the others.
  const last = active[active.length - 1];
  const reps = last && !full.includes(last) && last.m >= len * 0.6 && last.m < len && last === (segments ?? []).filter(s => s.kind !== 'free' || s.m >= 100).at(-1) ? [...full, last] : full;
  const sec = reps.reduce((a, r) => a + r.pace * r.m / 1000, 0);
  const m = reps.reduce((a, r) => a + r.m, 0);
  const scored = reps.filter(r => r.target);
  return {
    title: `${reps.length} × ${len >= 3000 && len % 1000 === 0 ? `${len / 1000}K` : len}`,
    reps: reps.length,
    hit: scored.length === reps.length ? reps.filter(onTarget).length : null,
    repPace: Math.round(sec / (m / 1000)),
  };
}
