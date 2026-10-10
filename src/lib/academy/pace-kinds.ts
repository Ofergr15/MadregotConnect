/**
 * The three kinds of pace a coach's pace update moves (lib/academy/coach-tools.ts), and the
 * one rule for which kind a pace is. Dependency-free so both the workout book (book-steps.ts,
 * the screens) and the coach tools (the stored weeks, the send) classify and shift a pace
 * with the SAME function — the number a coach sees is the number the watch gets.
 */

/** The book's colour split, the mockup's own: easy below 88% of threshold speed, tempo to 103%, fast above. */
export function toneOfPct(pct: number): 'e' | 't' | 'f' {
  if (pct < 88) return 'e';
  if (pct <= 103) return 't';
  return 'f';
}

export type PaceKind = 'reps' | 'tempo' | 'easy';
export const PACE_KINDS: readonly PaceKind[] = ['reps', 'tempo', 'easy'];

/** Sec/km per kind. Negative = faster. A missing kind is 0. */
export type PaceAdjust = Partial<Record<PaceKind, number>>;

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
  return Math.round(adjust[paceKindOf(centreSec, thresholdSec)] ?? 0);
}

/**
 * The inverse: the pace before the update that comes out at `shownSec` after it. Tries each
 * kind's shift and keeps the one whose unshifted pace really is that kind; none fits (only at
 * a kind boundary) → the pace as given.
 */
export function unshiftPace(shownSec: number, thresholdSec: number, adjust: PaceAdjust | null | undefined): number {
  if (!adjust || !(thresholdSec > 0)) return shownSec;
  for (const k of PACE_KINDS) {
    const by = Math.round(adjust[k] ?? 0);
    const base = shownSec - by;
    if (base > 0 && paceKindOf(base, thresholdSec) === k) return base;
  }
  return shownSec;
}
