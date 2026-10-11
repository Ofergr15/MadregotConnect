/**
 * The pace range a step carries on the watch (spec §3.8, mockup 4: "טווח בשעון 4:01–4:09").
 *
 * Work steps get the target ±1.5%, easy and recovery steps ±5%, rounded to the second:
 * 4:05 gives 4:01–4:09 (245 × 0.015 = 3.7 → 4 s; the spec's "4:02–4:08" was a typo).
 * When the plan row already stores a real range (min and max both set and different),
 * that is what Garmin was sent, so that is what the screen prints.
 *
 * This is what lib/garmin/converter.ts writes on the academy path (`paceTarget`) as the
 * step's pace zone, and what screen 4 prints (work steps only), so the watch and the
 * screen cannot disagree. `watchRangeKind` decides work or easy for both.
 */

export const WORK_PCT = 1.5;
export const EASY_PCT = 5;

export type RangeKind = 'work' | 'easy';

const WORK_ZONES = new Set(['tempo', 'threshold', 'interval', 'sprint', 'marathon_pace']);

/**
 * Work or easy, from the step alone (the converter has no threshold): warmup, cooldown and
 * the jogs are easy; an interval step, a work zone, or an unzoned step inside a repeat is
 * work; any other step is easy.
 */
export function watchRangeKind(
  step: { type?: string | null; targetZone?: string | null },
  inRepeat = false,
): RangeKind {
  const type = step.type ?? '';
  if (type === 'warmup' || type === 'cooldown' || type === 'recovery' || type === 'rest') return 'easy';
  if (type === 'interval') return 'work';
  if (step.targetZone) return WORK_ZONES.has(step.targetZone) ? 'work' : 'easy';
  return inRepeat ? 'work' : 'easy';
}

export function watchRange(
  step: { targetPaceMinPerKm?: number | null; targetPaceMaxPerKm?: number | null },
  kind: RangeKind,
): { min: number; max: number } | null {
  const a = Number(step.targetPaceMinPerKm) || 0;
  const b = Number(step.targetPaceMaxPerKm) || 0;
  if (a > 0 && b > 0 && a !== b) return { min: Math.min(a, b), max: Math.max(a, b) };
  const target = a || b;
  if (!(target > 0)) return null;
  const pct = (kind === 'work' ? WORK_PCT : EASY_PCT) / 100;
  return { min: Math.round(target * (1 - pct)), max: Math.round(target * (1 + pct)) };
}
