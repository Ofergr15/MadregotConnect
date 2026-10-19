/**
 * Who gets a day's workout, and what their week becomes — the pure half of "לשלוח".
 *
 * The send screen offers the same session to the coach's other trainees, "each at their
 * own pace". Three rules decide who actually receives it, and they are the mockup's own:
 *
 *   - no usable test → priced from their BAND's own threshold
 *     (`academy_bands.pace_profile.thresholdPaceSec`), and the session says so ("קצב לפי
 *     הדבוקה — עוד אין טסט") on the watch and in the app. Only a pace the band actually
 *     has: a band without one is not guessed from a club lane (2026-10-19 — the bands'
 *     paces have never been set, and a lane is a different squad). No test and no band
 *     pace → not sent (`no-test`, "אין קצבים לדבוקה — צריך טסט או קצבי דבוקה").
 *   - already has a workout that day → skipped. Sending would silently replace a session
 *     their coach wrote for them. The PRIMARY trainee is the exception: replacing their
 *     day is what the coach opened this screen to do.
 *   - not an active academy trainee → skipped.
 *
 * Pure. The route reads the facts, this decides, the route writes.
 */

import type { ParsedWorkout } from '@/lib/ai/types';

export interface SendCandidate {
  id: string;
  isPrimary: boolean;
  thresholdSec: number | null;
  /** The band's reference threshold (sec/km) used when there is no test; null = no band. */
  fallbackThresholdSec?: number | null;
  hasWorkoutThatDay: boolean;
  isAcademy: boolean;
  active: boolean;
}

export type SkipReason = 'no-test' | 'has-workout' | 'not-academy';

/** Where a trainee's paces come from: their own test, or their band while they have none. */
export type PaceBasis = 'test' | 'band';

/** The line a band-priced session carries, on the watch and in the app. */
export const BAND_PACE_NOTE = 'קצב לפי הדבוקה — עוד אין טסט';

export type SendDecision =
  | { id: string; action: 'send'; thresholdSec: number; basis: PaceBasis }
  | { id: string; action: 'skip'; reason: SkipReason };

/** The threshold to price with, and where it came from; `sec: null` = nothing to price with. */
export function resolveThreshold(
  testSec: number | null | undefined,
  fallbackSec: number | null | undefined,
): { sec: number | null; basis: PaceBasis | null } {
  if (testSec && testSec > 0) return { sec: testSec, basis: 'test' };
  if (fallbackSec && fallbackSec > 0) return { sec: fallbackSec, basis: 'band' };
  return { sec: null, basis: null };
}

export function decideRecipients(candidates: SendCandidate[]): SendDecision[] {
  return candidates.map((c): SendDecision => {
    if (!c.isAcademy || !c.active) return { id: c.id, action: 'skip', reason: 'not-academy' };
    const { sec, basis } = resolveThreshold(c.thresholdSec, c.fallbackThresholdSec);
    if (!sec || !basis) return { id: c.id, action: 'skip', reason: 'no-test' };
    if (c.hasWorkoutThatDay && !c.isPrimary) return { id: c.id, action: 'skip', reason: 'has-workout' };
    return { id: c.id, action: 'send', thresholdSec: sec, basis };
  });
}

/**
 * The band's own threshold pace (sec/km), or null when the band has none — the ONE place
 * every academy pricing path (day-plan, copy-week, missed-week, the composer's book slots)
 * reads the fallback from, so they cannot drift apart.
 */
export function bandThresholdSec(profile: { thresholdPaceSec?: number | null } | null | undefined): number | null {
  const sec = profile?.thresholdPaceSec;
  return typeof sec === 'number' && sec > 0 ? Math.round(sec) : null;
}

/**
 * A week's workouts as priced for one trainee: band-priced ones (basis 'band') carry the
 * band line, test-priced and unpriced ones are returned as they are. `paced` per workout
 * says which ones actually got paces (a copy with no threshold has none to label).
 */
export function markBandPriced<W extends { description?: string }>(
  workouts: Array<{ workout: W; paced: boolean }>,
  basis: PaceBasis | null,
): W[] {
  return workouts.map(({ workout, paced }) => (basis === 'band' && paced ? withBandDescription(workout) : workout));
}

/** A workout priced from the band: the band line goes first in its description. */
export function withBandDescription<W extends { description?: string }>(workout: W): W {
  return { ...workout, description: withBandNote(workout.description) };
}

/** A band-priced session's notes: the band line first, then whatever the coach wrote. */
export function withBandNote(notes: string | null | undefined): string {
  const rest = (notes || '').trim();
  if (rest.startsWith(BAND_PACE_NOTE)) return rest;
  return rest ? `${BAND_PACE_NOTE}\n${rest}` : BAND_PACE_NOTE;
}

/** True when a week already holds a session on this day. */
export function hasWorkoutOn(workouts: ParsedWorkout[], dayOfWeek: number): boolean {
  return workouts.some(w => w?.dayOfWeek === dayOfWeek && Array.isArray(w.steps) && w.steps.length > 0);
}

/**
 * The week with `next` on its day. Every part already on that day goes — a day replaced is
 * replaced whole, or a two-part day would keep its evening run beside the new session —
 * and the rest of the week is kept exactly as it was, in day order.
 */
export function mergeDay(workouts: ParsedWorkout[], next: ParsedWorkout): ParsedWorkout[] {
  const kept = workouts.filter(w => w?.dayOfWeek !== next.dayOfWeek);
  // The part fields of whatever was there before describe a day that no longer exists.
  const { partIndex: _i, partCount: _c, partKind: _k, workoutKey: _key, ...clean } = next;
  void _i; void _c; void _k; void _key;
  return [...kept, clean].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}
