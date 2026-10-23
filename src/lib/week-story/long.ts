import type { WorkoutStep } from '@/lib/ai/types';

// The long run's slide (mockup week-story-v2/v3.html): one square per km of the main
// block against the pace the plan set for that km. Pure, for the server and the tests.

/** Per km, the plan's [fastest, slowest] pace (s/km) over the session's main block: the longest
 *  stretch of consecutive distance steps with a pace. Warm-up drills and strides are not km. */
export function planKmPaces(steps: WorkoutStep[]): Array<[number, number]> {
  const flat: WorkoutStep[] = [];
  for (const s of steps) {
    if (s.repeatSteps?.length && (s.repeatCount ?? 0) > 1) for (let i = 0; i < (s.repeatCount ?? 0); i++) flat.push(...s.repeatSteps);
    else flat.push(s);
  }
  let best: Array<[number, number]> = [];
  let cur: Array<[number, number]> = [];
  for (const s of flat) {
    const paced = s.durationType === 'distance' && (s.durationValue ?? 0) >= 1000 && s.targetType === 'pace'
      && s.targetPaceMinPerKm != null && s.type !== 'warmup' && s.type !== 'cooldown';
    if (!paced) { if (cur.length > best.length) best = cur; cur = []; continue; }
    const lo = s.targetPaceMinPerKm!, hi = s.targetPaceMaxPerKm ?? lo;
    for (let k = 0; k < Math.round(s.durationValue! / 1000); k++) cur.push([Math.min(lo, hi), Math.max(lo, hi)]);
  }
  if (cur.length > best.length) best = cur;
  // A 1 km easy jog after the block is a cool-down whatever the coach called it.
  while (best.length > 1 && best[best.length - 1][0] - best[0][0] >= 45) best = best.slice(0, -1);
  return best.length >= 5 ? best : [];
}

export type KmMark = 'on' | 'fast' | 'slow';
/** On plan = inside the band, 3 s of slack slower and 8 s faster (a long run run a touch quick is fine). */
export function markKm(p: number, [lo, hi]: [number, number]): KmMark {
  if (p > hi + 3) return 'slow';
  if (p < lo - 8) return 'fast';
  return 'on';
}

/**
 * The runner's km that ran the block: the stretch of full km that sits closest to the plan,
 * pairs of [pace run, the plan's km]. A jog at either end (45 s+ off the band) is the warm-up
 * or the cool-down caught in the window, not the block.
 */
export function pairKm(actual: number[], plan: Array<[number, number]>): Array<{ p: number; lo: number; hi: number }> {
  const got = alignKm(actual, plan);
  let pairs = got.map((p, i) => ({ p, lo: plan[i][0], hi: plan[i][1] }));
  while (pairs.length && pairs[0].p > pairs[0].hi + 45) pairs = pairs.slice(1);
  while (pairs.length && pairs[pairs.length - 1].p > pairs[pairs.length - 1].hi + 45) pairs = pairs.slice(0, -1);
  return pairs;
}

export function alignKm(actual: number[], plan: Array<[number, number]>): number[] {
  if (!plan.length || !actual.length) return [];
  if (actual.length <= plan.length) return actual;
  const mid = plan.map(([a, b]) => (a + b) / 2);
  let best = 0, bestErr = Infinity;
  for (let o = 0; o + plan.length <= actual.length; o++) {
    let e = 0;
    for (let i = 0; i < plan.length; i++) e += Math.abs(actual[o + i] - mid[i]);
    if (e < bestErr) { bestErr = e; best = o; }
  }
  return actual.slice(best, best + plan.length);
}
