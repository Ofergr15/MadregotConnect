/**
 * Who gets a day's workout, and what their week becomes — the pure half of "לשלוח".
 *
 * The send screen offers the same session to the coach's other trainees, "each at their
 * own pace". Three rules decide who actually receives it, and they are the mockup's own:
 *
 *   - no usable test → priced from their BAND instead: the reference threshold of the
 *     lane their דבוקה trains in (`laneReferences`, the club's own squad paces), and the
 *     session says so ("קצב לפי הדבוקה — עוד אין טסט") on the watch and in the app
 *     (Ofer, 2026-10-19: a trainee without a test still gets their coach's workout).
 *     No band either → not sent (`no-test`); the row offers "קביעת טסט" instead.
 *   - already has a workout that day → skipped. Sending would silently replace a session
 *     their coach wrote for them. The PRIMARY trainee is the exception: replacing their
 *     day is what the coach opened this screen to do.
 *   - not an active academy trainee → skipped.
 *
 * Pure. The route reads the facts, this decides, the route writes.
 */

import type { ParsedWorkout } from '@/lib/ai/types';
import { laneForBand, type Lane } from './group-lane';

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

/** The band's reference threshold: the club lane its דבוקה trains in. Null without a band. */
export function bandReferenceSec(bandNumber: number | null | undefined, refs: Record<Lane, number>): number | null {
  const lane = laneForBand(bandNumber);
  return lane ? refs[lane] ?? null : null;
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
