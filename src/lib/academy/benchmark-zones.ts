/**
 * 2000 m benchmark → PROPOSED pace zones. A proposal only (NOTES Q6 default): the coach sees
 * it beside the current zones and applies it by repacing the week (repace.ts `repaceWeek`
 * with `offsetSec`), never automatically.
 *
 * Zones are offsets from the 2000 m pace per km, in sec/km — the club's long-standing rule of
 * thumb for a 7–9 min 2000 m runner. Kept as data so the coach page can show the arithmetic.
 */
import { MAX_PACE_SEC_PER_KM, MIN_PACE_SEC_PER_KM } from './repace';

export const ZONE_OFFSETS = {
  rep: [-5, 5],
  interval: [5, 15],
  tempo: [45, 60],
  easy: [100, 130],
} as const;

export type ZoneName = keyof typeof ZONE_OFFSETS;
export interface Zone { name: ZoneName; fromSec: number; toSec: number }

export function pacePerKmFrom2000(totalSec: number): number {
  return totalSec / 2;
}

/** Null when the time is not a plausible 2000 m (pace outside repace's sane bounds). */
export function proposedZones(total2000Sec: number): Zone[] | null {
  if (!Number.isFinite(total2000Sec) || total2000Sec <= 0) return null;
  const base = pacePerKmFrom2000(total2000Sec);
  if (base < MIN_PACE_SEC_PER_KM || base > MAX_PACE_SEC_PER_KM) return null;
  return (Object.keys(ZONE_OFFSETS) as ZoneName[]).map((name) => ({
    name,
    fromSec: Math.round(base + ZONE_OFFSETS[name][0]),
    toSec: Math.round(base + ZONE_OFFSETS[name][1]),
  }));
}

/** Seconds per km to shift the trainee's plan by: new − previous 2000 m pace (negative = faster). */
export function repaceOffset(prev2000Sec: number | null, next2000Sec: number): number | null {
  if (prev2000Sec == null || prev2000Sec <= 0) return null;
  return Math.round(pacePerKmFrom2000(next2000Sec) - pacePerKmFrom2000(prev2000Sec));
}
