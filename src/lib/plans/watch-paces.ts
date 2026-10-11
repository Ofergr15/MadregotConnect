// ── Every pack's pace on every watch ────────────────────────────────────────────
//
// A club plan is stored as three copies, one per pack (group1/2/3), each narrowed to
// that pack's pace: the split (lib/ai/splitGroups.ts) turns "4:15 (4:25) ((4:35))" into
// "4:25" for pack ❷ and deletes the other two. That was the rule when the 3-pack plans
// came in (commit 20ad09ba: "Group 2 sees 4:24 instead of 4:15 (4:24) ((4:36))"), and it
// is still right for the per-pack clipboard images and for the academy lanes built
// from those copies. It is wrong on the watch: a runner who drops back a pack mid-run
// has only their own pack's number, and the club runs on moving between packs.
//
// So the stored copies are left alone and the watch gets the three paces at the moment
// it is sent: the same step, found in all three copies, gives `groupPaces`, and the
// watch text (garmin/converter.ts buildStepDescription) prints them — once when the
// three are the same (a warm-up), `A (B) ((C))` when they differ.

import type { GroupPace, ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { normalizeParsedWorkouts } from '@/lib/plans/normalize-plan';
import { samePace as same } from '@/lib/plans/group-pace-text';

type Grouped = Record<'group1' | 'group2' | 'group3', { workouts?: ParsedWorkout[] }>;

const own = (s: WorkoutStep | undefined): GroupPace | null =>
  s?.targetPaceMinPerKm ? { min: s.targetPaceMinPerKm, max: s.targetPaceMaxPerKm ?? s.targetPaceMinPerKm } : null;


function enrichStep(step: WorkoutStep, copies: (WorkoutStep | undefined)[]): WorkoutStep {
  const out: WorkoutStep = { ...step };
  if (step.repeatSteps) {
    out.repeatSteps = step.repeatSteps.map((c, j) => enrichStep(c, copies.map((s) => s?.repeatSteps?.[j])));
    return out;
  }
  const [p1, p2, p3] = copies.map(own);
  const mine = own(step);
  // Only when it is provably the same step: all three packs have a pace there and the
  // step being sent carries one of them. A plan edited out of shape since it was
  // saved falls back to what the watch showed before, never to someone else's pace.
  if (p1 && p2 && p3 && mine && (same(mine, p1) || same(mine, p2) || same(mine, p3))) {
    out.groupPaces = [p1, p2, p3];
  }
  return out;
}

/**
 * The pack copy of a week being sent to a watch, with `groupPaces` on every paced step.
 * `stored` is the plan row's `parsed_workouts`. A flat plan (one pace for everyone, or an
 * academy trainee's own week) has nothing to add and comes back unchanged.
 */
export function withGroupPaces(workouts: ParsedWorkout[], stored: unknown): ParsedWorkout[] {
  if (!stored || typeof stored !== 'object' || !('group1' in stored)) return workouts;
  const grouped = normalizeParsedWorkouts(stored as Grouped);
  const byKey = (n: 1 | 2 | 3, key: string | undefined) =>
    key ? grouped[`group${n}`]?.workouts?.find((w) => w.workoutKey === key) : undefined;
  return workouts.map((w) => {
    const copies = ([1, 2, 3] as const).map((n) => byKey(n, w.workoutKey));
    if (copies.some((c) => !c || c.steps.length !== w.steps.length)) return w;
    return { ...w, steps: w.steps.map((s, i) => enrichStep(s, copies.map((c) => c!.steps[i]))) };
  });
}
