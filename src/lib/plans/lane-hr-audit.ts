import type { WorkoutStep } from '@/lib/ai/types';

/**
 * READ-ONLY audit of a stored, pre-split plan (`parsed_workouts` with group1/group2/group3 buckets)
 * for steps the old split may have flipped from pace to heart rate in lanes 2/3 (fixed in
 * splitGroups.ts). Pure: no DB, no repair, no inference of what the coach meant.
 *
 *  - `likely_flip`: lane 1 is a pace step, this lane is `heart_rate`, AND this lane's step carries a
 *    pace DIFFERENT from lane 1's (the old split set the lane's own pace first, then flipped the type).
 *    A lane pace equal to lane 1's is no evidence: the old split copied lane 1's onto every lane.
 *  - `ambiguous`: lane 1 is pace, this lane is `heart_rate`, and this lane has NO pace of its own. That
 *    is also what a coach writing "lanes 2/3 by HR" produces, so it is reported, never classified.
 *  Everything else is not reported.
 */
export type LaneHrFinding = {
  lane: 2 | 3;
  dayOfWeek: number;
  partIndex: number | null;
  /** Path into the step list: [stepIndex] or [stepIndex, repeatChildIndex, …]. */
  path: number[];
  kind: 'likely_flip' | 'ambiguous';
  lanePace: { min: number; max: number } | null;
  laneHr: { min: number; max: number | null };
};

type Bucket = { workouts?: Array<{ dayOfWeek: number; partIndex?: number; steps?: WorkoutStep[] }> };
const realPace = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function auditLaneHr(parsed: unknown): LaneHrFinding[] {
  const p = parsed as Partial<Record<'group1' | 'group2' | 'group3', Bucket>> | null;
  if (!p || typeof p !== 'object' || !p.group1?.workouts) return [];
  const out: LaneHrFinding[] = [];
  for (const lane of [2, 3] as const) {
    const bucket = p[`group${lane}`]?.workouts;
    if (!bucket) continue;
    for (const w1 of p.group1.workouts) {
      const same = (w: { dayOfWeek: number; partIndex?: number }) =>
        w.dayOfWeek === w1.dayOfWeek && (w.partIndex ?? null) === (w1.partIndex ?? null);
      const wl = bucket.find(same);
      if (!wl) continue;
      const walk = (a: WorkoutStep[] = [], b: WorkoutStep[] = [], path: number[]) => {
        a.forEach((s1, i) => {
          const sl = b[i];
          if (!sl) return;
          if (s1.repeatSteps?.length || sl.repeatSteps?.length) walk(s1.repeatSteps, sl.repeatSteps, [...path, i]);
          if (s1.targetType !== 'pace' || !realPace(s1.targetPaceMinPerKm) || sl.targetType !== 'heart_rate') return;
          // The old split copied lane 1's pace onto every lane before flipping, so a lane pace equal to
          // lane 1's may be inherited, not written for this lane: only a DIFFERENT pace is evidence.
          const hasPace = realPace(sl.targetPaceMinPerKm) &&
            (sl.targetPaceMinPerKm !== s1.targetPaceMinPerKm || (sl.targetPaceMaxPerKm ?? null) !== (s1.targetPaceMaxPerKm ?? null));
          out.push({
            lane, dayOfWeek: w1.dayOfWeek, partIndex: w1.partIndex ?? null, path: [...path, i],
            kind: hasPace ? 'likely_flip' : 'ambiguous',
            lanePace: hasPace ? { min: sl.targetPaceMinPerKm!, max: sl.targetPaceMaxPerKm ?? sl.targetPaceMinPerKm! } : null,
            laneHr: { min: sl.targetHrMinPct ?? 0, max: sl.targetHrMaxPct ?? null },
          });
        });
      };
      walk(w1.steps, wl.steps, []);
    }
  }
  return out;
}
