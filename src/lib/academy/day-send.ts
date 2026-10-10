/**
 * Who gets a day's workout, and what their week becomes — the pure half of "לשלוח".
 *
 * The send screen offers the same session to the coach's other trainees, "each at their
 * own pace". Three rules decide who actually receives it, and they are the mockup's own:
 *
 *   - no usable test → not sent. The entry stores `110% of threshold`, and 110% of
 *     nothing is not a pace; the row offers "קביעת טסט" instead. Never a guessed pace.
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
  hasWorkoutThatDay: boolean;
  isAcademy: boolean;
  active: boolean;
}

export type SkipReason = 'no-test' | 'has-workout' | 'not-academy';

export type SendDecision =
  | { id: string; action: 'send'; thresholdSec: number }
  | { id: string; action: 'skip'; reason: SkipReason };

export function decideRecipients(candidates: SendCandidate[]): SendDecision[] {
  return candidates.map((c): SendDecision => {
    if (!c.isAcademy || !c.active) return { id: c.id, action: 'skip', reason: 'not-academy' };
    if (!c.thresholdSec || !(c.thresholdSec > 0)) return { id: c.id, action: 'skip', reason: 'no-test' };
    if (c.hasWorkoutThatDay && !c.isPrimary) return { id: c.id, action: 'skip', reason: 'has-workout' };
    return { id: c.id, action: 'send', thresholdSec: c.thresholdSec };
  });
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
