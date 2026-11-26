import type { ParsedWorkout } from '@/lib/ai/types';
import type { Lane } from '@/lib/academy/group-lane';
import { flattenPlannedSteps } from '@/lib/academy/segments';
import { dominantBlock, gradePlanBlocks, type Trace } from '@/lib/academy/execution';
import { isRepeatMarker, stepPaceBand, type ExecutedWorkout } from '@/lib/garmin/executed-workout';

// ── Which pack did the runner actually run with? ────────────────────────────
// A runner's assigned pack is where they USUALLY run, not a fact about every run:
// people tag along with the next pack up on a good day and drop a pack on a tired
// one. Grading such a run against the assigned pack's paces turns a perfectly run
// pack-3 session into "slower than target" (owner report 2026-11-26). So the lane a
// run is graded on is resolved per run, best evidence first:
//
//   manual   — the runner (or staff) said "I ran with pack N" on this run.
//   pace     — the main block's actual pace sits clearly inside one pack's band and
//              clearly closer to it than to any other (a confidence margin).
//   watch    — the workout on the watch carried ONE pack's paces.
//   assigned — nothing above could tell; the pack they're in on that day.
//
// Pace outranks the watch on purpose (owner, 2026-11-26): the watch holds whatever
// pack's copy was PUSHED, which is the pack the runner was in at push time — Ofer's
// Thursday carried pack 2's 3:53/3:45/3:38 while he ran 4:02/3:55/3:46 with pack 3,
// moved to pack 3 that morning. When the graded lane differs from the watch's,
// `retargetToLane` keeps the watch's step STRUCTURE and swaps in that lane's paces.

export type LaneSource = 'manual' | 'watch' | 'pace' | 'assigned';

export interface RanLane {
  lane: Lane;
  source: LaneSource;
}

const LANES: Lane[] = [1, 2, 3];

/** A watch band and a plan band are "the same pace" within this many s/km. */
const WATCH_MATCH_SEC = 3;
/**
 * How much closer (s/km, band centre to actual) the best pack must be than the
 * runner-up before the actual pace is allowed to overrule the assigned pack. The
 * packs sit ~10 s/km apart, so 4 is "clearly nearer one of them", not a coin toss.
 */
const PACE_MARGIN_SEC = 4;

const centre = (b: { min: number; max: number }) => (b.min + b.max) / 2;

function planBands(workout: ParsedWorkout | undefined): { min: number; max: number }[] {
  if (!workout) return [];
  return flattenPlannedSteps(workout)
    .filter(s => s.graded && s.paceMin != null && s.paceMax != null)
    .map(s => ({ min: s.paceMin as number, max: s.paceMax as number }));
}

/**
 * The pack whose plan paces are the ones on the watch, or null when the watch can't
 * say: no paced steps, notes still carrying all three packs' notation (any lane reads
 * its own out of them — that's no evidence of which one was followed), the packs
 * share one pace, or the paces fit no pack / more than one.
 */
export function laneFromWatch(
  executed: ExecutedWorkout | null | undefined,
  plannedFor: (lane: Lane) => ParsedWorkout | undefined,
): Lane | null {
  if (!executed?.steps?.length) return null;
  const bands: { min: number; max: number }[] = [];
  for (const step of executed.steps) {
    if (isRepeatMarker(step)) continue;
    const perLane = LANES.map(l => stepPaceBand(step, l));
    if (!perLane[0]) continue;
    // Bracket notation on the watch: the step reads differently per lane, so it is
    // the full three-pack note, not one pack's pace.
    if (perLane.some(b => !b || b.min !== perLane[0]!.min || b.max !== perLane[0]!.max)) return null;
    bands.push(perLane[0]);
  }
  if (!bands.length) return null;

  const fits = LANES.filter(lane => {
    const plan = planBands(plannedFor(lane));
    if (!plan.length) return false;
    return bands.every(b => plan.some(p => Math.abs(centre(p) - centre(b)) <= WATCH_MATCH_SEC));
  });
  return fits.length === 1 ? fits[0] : null;
}

/**
 * The pack whose main-block band the run's main block fits, with a margin — or null.
 * Each lane's plan is searched on its own (`gradePlanBlocks`), since the block's
 * window is located through its band; `dominantBlock` picks the one stretch the
 * verdict is about, the same rule every surface grades with.
 */
export function laneFromPace(
  trace: Trace | null,
  plannedFor: (lane: Lane) => ParsedWorkout | undefined,
  paceSec: number,
): Lane | null {
  if (!trace) return null;
  const scored: { lane: Lane; miss: number; off: number }[] = [];
  for (const lane of LANES) {
    const workout = plannedFor(lane);
    if (!workout) continue;
    const block = dominantBlock(gradePlanBlocks(flattenPlannedSteps(workout), trace, paceSec));
    if (!block || block.actualPace == null) continue;
    const a = block.actualPace;
    const miss = a < block.plannedPaceMin ? block.plannedPaceMin - a : a > block.plannedPaceMax ? a - block.plannedPaceMax : 0;
    scored.push({ lane, miss, off: Math.abs(a - (block.plannedPaceMin + block.plannedPaceMax) / 2) });
  }
  if (scored.length < 2) return null;
  scored.sort((x, y) => x.miss - y.miss || x.off - y.off);
  const [best, next] = scored;
  if (best.miss > paceSec) return null;          // fits none of them
  if (next.off - best.off < PACE_MARGIN_SEC) return null; // packs too close to call
  return best.lane;
}

export function resolveRanLane(input: {
  assigned: Lane;
  override?: number | null;
  executed?: ExecutedWorkout | null;
  trace?: Trace | null;
  plannedFor: (lane: Lane) => ParsedWorkout | undefined;
  paceSec: number;
}): RanLane {
  const o = input.override;
  if (o === 1 || o === 2 || o === 3) return { lane: o, source: 'manual' };
  const pace = laneFromPace(input.trace ?? null, input.plannedFor, input.paceSec);
  if (pace) return { lane: pace, source: 'pace' };
  const watch = laneFromWatch(input.executed, input.plannedFor);
  if (watch) return { lane: watch, source: 'watch' };
  return { lane: input.assigned, source: 'assigned' };
}

/**
 * The plan workout a stored match points at, else the run's own day. A run that did
 * tomorrow's session today is matched to tomorrow's slot (activity-matcher) — the
 * grading surfaces must then grade it against that slot, not against today's.
 */
export function pickPlanned(
  workouts: ParsedWorkout[],
  dayOfWeek: number,
  workoutKey?: string | null,
): ParsedWorkout | undefined {
  if (workoutKey) {
    const byKey = workouts.find(w => w.workoutKey === workoutKey);
    if (byKey) return byKey;
    // Un-normalized plans carry no key; the key is derived from day and part.
    const m = /^day-(\d)-part-(\d+)/.exec(workoutKey);
    if (m) {
      const day = Number(m[1]);
      const part = Number(m[2]);
      const hit = workouts.find(w => w.dayOfWeek === day && (w.partIndex || 1) === part)
        ?? workouts.find(w => w.dayOfWeek === day);
      if (hit) return hit;
    }
  }
  return workouts.find(w => w.dayOfWeek === dayOfWeek);
}

/**
 * The watch's step list with each paced step's target replaced by `lane`'s pace, when
 * the workout on the device was built for another lane. Steps are mapped through the
 * plan: a watch band is matched to the nearest band of the lane it was built for, and
 * the same position in `lane`'s plan supplies the new target (the lanes share every
 * step and differ only in pace). Unchanged when the watch's lane can't be told (notes
 * carrying all three packs already read per lane) or is already `lane`.
 */
export function retargetToLane(
  executed: ExecutedWorkout | null,
  lane: Lane,
  plannedFor: (lane: Lane) => ParsedWorkout | undefined,
): ExecutedWorkout | null {
  if (!executed) return executed;
  const from = laneFromWatch(executed, plannedFor);
  if (!from || from === lane) return executed;
  const fromBands = planBands(plannedFor(from));
  const toBands = planBands(plannedFor(lane));
  if (!fromBands.length || fromBands.length !== toBands.length) return executed;
  return {
    ...executed,
    steps: executed.steps.map(step => {
      if (isRepeatMarker(step)) return step;
      const band = stepPaceBand(step, from);
      if (!band) return step;
      let best = -1;
      let bestOff = Infinity;
      fromBands.forEach((b, i) => {
        const off = Math.abs(centre(b) - centre(band));
        if (off < bestOff) { bestOff = off; best = i; }
      });
      if (best < 0 || bestOff > WATCH_MATCH_SEC) return step;
      return { ...step, paceMin: toBands[best].min, paceMax: toBands[best].max };
    }),
  };
}
