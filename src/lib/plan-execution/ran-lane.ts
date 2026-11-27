import type { ParsedWorkout } from '@/lib/ai/types';
import type { Lane } from '@/lib/academy/group-lane';
import { flattenPlannedSteps } from '@/lib/academy/segments';
import { isRepeatMarker, stepPaceBand, type ExecutedWorkout } from '@/lib/garmin/executed-workout';

// ── Which pack did the runner actually run with? ────────────────────────────
// A runner's assigned pack is where they USUALLY run, not a fact about every run:
// people tag along with the next pack up on a good day and drop a pack on a tired
// one (owner report 2026-11-26). But the lane is also what a miss is measured
// against, so it moves off the assigned pack only on EVIDENCE, never on pace alone
// (QA 2026-11-27, Q27-2): detecting the lane from the pace made a pack-2 runner
// asked for 3:45 who ran 3:55 "a pack-3 runner on target" — every slow run inside a
// slower pack's band scored 100, and the verdict could no longer say "slower".
//
//   manual     — the runner (or staff) said "I ran with pack N" on this run.
//   stored     — an earlier resolution saved on activity_plan_matches (migration 224),
//                so the feed ring and the run detail read ONE lane (one-verdict rule).
//   attendance — a pack leader marked them present with pack N that day (pack_attendance).
//   watch      — the workout on the watch carried ONE pack's paces — unless that is
//                just the copy pushed for the pack they were in when the week was
//                pushed and have since left (Ofer's Thursday: pack 2's 3:53/3:45/3:38
//                on the wrist, moved to pack 3 that morning — the assigned pack on the
//                day already says 3, and the stale push is not evidence against it).
//   assigned   — nothing above; the pack they're in on that day.
//
// When the graded lane differs from the watch's, `retargetToLane` keeps the watch's
// step STRUCTURE and swaps in that lane's paces.

export type LaneSource = 'manual' | 'attendance' | 'watch' | 'assigned';

export interface RanLane {
  lane: Lane;
  source: LaneSource;
}

const LANES: Lane[] = [1, 2, 3];

/** A watch band and a plan band are "the same pace" within this many s/km. */
const WATCH_MATCH_SEC = 3;

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

const asLane = (v: unknown): Lane | null => (v === 1 || v === 2 || v === 3 ? v : null);

export function resolveRanLane(input: {
  assigned: Lane;
  override?: number | null;
  /** The lane saved on the run's plan match by an earlier resolution (224), with its source. */
  stored?: { lane: number | null; source: string | null } | null;
  /** A pack leader's "present" mark for that day, as a lane — null when none or ambiguous. */
  attended?: number | null;
  executed?: ExecutedWorkout | null;
  /** The pack they were in when the week was pushed (plan week start) — see "watch" above. */
  pushedLane?: number | null;
  plannedFor: (lane: Lane) => ParsedWorkout | undefined;
}): RanLane {
  const o = asLane(input.override);
  if (o) return { lane: o, source: 'manual' };
  // A stored EVIDENCE answer is the run's lane; a stored 'assigned' may still be
  // upgraded by evidence that arrived later (a step list fetched on demand, a leader's mark).
  const st = asLane(input.stored?.lane);
  const stSrc = input.stored?.source;
  if (st && (stSrc === 'attendance' || stSrc === 'watch')) return { lane: st, source: stSrc };
  const att = asLane(input.attended);
  if (att) return { lane: att, source: 'attendance' };
  const watch = laneFromWatch(input.executed, input.plannedFor);
  const pushed = asLane(input.pushedLane);
  const stalePush = !!watch && pushed === watch && watch !== input.assigned;
  if (watch && !stalePush) return { lane: watch, source: 'watch' };
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
