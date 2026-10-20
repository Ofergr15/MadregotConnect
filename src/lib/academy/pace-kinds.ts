/**
 * The three kinds of pace a coach's pace update moves (lib/academy/coach-tools.ts), and the
 * one rule for which kind a pace is. Free of server code so both the workout book (book-steps.ts,
 * the screens) and the coach tools (the stored weeks, the send) classify and shift a pace
 * with the SAME function — the number a coach sees is the number the watch gets.
 */

/** The book's colour split, the mockup's own: easy below 88% of threshold speed, tempo to 103%, fast above. */
export function toneOfPct(pct: number): 'e' | 't' | 'f' {
  if (pct < 88) return 'e';
  if (pct <= 103) return 't';
  return 'f';
}

import { zoneCentrePace, zoneOfPace } from './library';

export type PaceKind = 'reps' | 'tempo' | 'easy';
export const PACE_KINDS: readonly PaceKind[] = ['reps', 'tempo', 'easy'];

/**
 * Sec/km per kind. Negative = faster. A missing kind is 0. `zones`: the coach's manual pace for
 * a named zone (library.ts ZONE_INTENSITY), ABSOLUTE sec/km — the strongest rule there is
 * (Ofer, 2026-10-20: manual zone > test > coach baseline > band). A pace in an overridden zone
 * moves by that zone's override; the kinds only move the zones nobody set by hand.
 */
export type PaceAdjust = Partial<Record<PaceKind, number>> & { zones?: ZoneOverrides };
export type ZoneOverrides = Partial<Record<string, number>>;

/** The shift (sec/km) a zone override gives a pace centred at `centreSec`, or null for none. */
export function zoneShift(centreSec: number, thresholdSec: number, zones: ZoneOverrides | null | undefined): number | null {
  if (!zones || !(thresholdSec > 0) || !(centreSec > 0)) return null;
  const z = zoneOfPace(centreSec, thresholdSec);
  const set = z ? zones[z] : undefined;
  const mid = z ? zoneCentrePace(thresholdSec, z) : null;
  return typeof set === 'number' && set > 0 && mid ? Math.round(set - mid) : null;
}

export function paceKindOfPct(pct: number): PaceKind {
  const tone = toneOfPct(pct);
  return tone === 'f' ? 'reps' : tone === 't' ? 'tempo' : 'easy';
}

/** The kind of a pace (the centre of its band, sec/km) for a trainee with this threshold. */
export function paceKindOf(paceSec: number, thresholdSec: number): PaceKind {
  return paceKindOfPct((thresholdSec / paceSec) * 100);
}

/** How far the update in force moves a pace whose band centres on `centreSec`. */
export function kindShift(centreSec: number, thresholdSec: number, adjust: PaceAdjust | null | undefined): number {
  if (!adjust || !(thresholdSec > 0) || !(centreSec > 0)) return 0;
  const byZone = zoneShift(centreSec, thresholdSec, adjust.zones);
  if (byZone != null) return byZone;
  return Math.round(adjust[paceKindOf(centreSec, thresholdSec)] ?? 0);
}

/**
 * The inverse: the pace before the update that comes out at `shownSec` after it. Tries each
 * kind's shift and keeps the one whose unshifted pace really is that kind; none fits (only at
 * a kind boundary) → the pace as given.
 */
export function unshiftPace(shownSec: number, thresholdSec: number, adjust: PaceAdjust | null | undefined): number {
  if (!adjust || !(thresholdSec > 0)) return shownSec;
  for (const [z, set] of Object.entries(adjust.zones ?? {})) {
    const mid = zoneCentrePace(thresholdSec, z);
    if (typeof set !== 'number' || !mid) continue;
    const base = shownSec - (set - mid);
    if (base > 0 && zoneOfPace(base, thresholdSec) === z) return base;
  }
  for (const k of PACE_KINDS) {
    const by = Math.round(adjust[k] ?? 0);
    const base = shownSec - by;
    if (base > 0 && paceKindOf(base, thresholdSec) === k) return base;
  }
  return shownSec;
}
