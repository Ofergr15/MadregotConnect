import type { WorkoutStep } from '@/lib/ai/types';

// The story copy says all three packs' paces in the club's notation — "3:50 (4:00) ((4:10))"
// (lib/plans/workout-story-text). A runner's screen holds only THEIR lane's steps, so the
// copy printed their pack's pace in the first slot and nothing in the others: different
// numbers from the plan the club posts (Ofer 10-23, "a very serious bug"). This puts the
// three lanes back together, step by step, on lane 1's structure.

type Pace = { min: number; max: number } | null;
const paceOf = (s: WorkoutStep | undefined): Pace =>
  s && s.targetPaceMinPerKm && s.targetPaceMaxPerKm
    ? { min: Math.min(s.targetPaceMinPerKm, s.targetPaceMaxPerKm), max: Math.max(s.targetPaceMinPerKm, s.targetPaceMaxPerKm) }
    : null;

/** Same shape: the same number of steps and the same repeats, all the way down. */
function sameShape(a: WorkoutStep[], b: WorkoutStep[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => {
    const t = b[i];
    if ((s.repeatCount ?? 0) !== (t.repeatCount ?? 0)) return false;
    const sa = s.repeatSteps ?? [], sb = t.repeatSteps ?? [];
    return sameShape(sa, sb);
  });
}

/**
 * Lane 1's steps, each carrying `groupPaces` [lane1, lane2, lane3]. A lane whose shape
 * differs (a pack running a different session) contributes nothing rather than a wrong
 * pace. Returns null when there is no lane 1 to build on.
 */
export function withLanePaces(lanes: Array<WorkoutStep[] | null | undefined>): WorkoutStep[] | null {
  const base = lanes[0];
  if (!base?.length) return null;
  const others = lanes.map((l) => (l && sameShape(base, l) ? l : null));
  const walk = (steps: WorkoutStep[], at: Array<WorkoutStep[] | null>): WorkoutStep[] =>
    steps.map((s, i) => {
      const peers = at.map((l) => l?.[i]);
      const out: WorkoutStep = { ...s, groupPaces: [paceOf(peers[0]), paceOf(peers[1]), paceOf(peers[2])] as never };
      if (s.repeatSteps?.length) out.repeatSteps = walk(s.repeatSteps, peers.map((p) => p?.repeatSteps ?? null));
      return out;
    });
  return walk(base, others);
}
