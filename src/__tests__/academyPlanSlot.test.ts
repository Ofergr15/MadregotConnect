import { describe, expect, it } from 'vitest';

import { ZONE_INTENSITY, resolveLibraryWorkout, type LibraryStep } from '@/lib/academy/library';
import {
  bookEntryIds,
  materialiseWeek,
  weekGaps,
  type PlanSlot,
  type Recipient,
} from '@/lib/academy/plan-slot';
import { repaceWeek } from '@/lib/academy/repace';
import type { ParsedWorkout } from '@/lib/ai/types';

/**
 * The one thing this layer exists to prevent: pace math applied twice.
 *
 * A week goes to several trainees at once. The old mechanism shifts the author's paces by each
 * trainee's band offset; the book's mechanism derives paces from each trainee's own threshold
 * test. Resolve a book entry once and drop the result in a slot, and the old mechanism then
 * shifts it again — trainee B gets trainee A's test plus B's offset, which is a number with no
 * meaning at all, and it looks perfectly plausible on screen.
 */

const REPS: LibraryStep[] = [
  {
    order: 1, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 6,
    repeatSteps: [
      { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace', targetZone: 'interval', intensity: ZONE_INTENSITY.interval },
      { order: 2, type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target', notes: '2:00 הליכה' },
    ],
  },
];

const BOOK: PlanSlot = { source: 'book', entry: { id: 'l1', name: 'אינטרוולים קלאסי', notes: null, steps: REPS } };

const WRITTEN_WORKOUT: ParsedWorkout = {
  dayOfWeek: 4, name: 'טמפו 20 דקות',
  steps: [{ order: 1, type: 'active', durationType: 'time', durationValue: 1200, targetType: 'pace', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 300 }],
};
const WRITTEN: PlanSlot = { source: 'written', workout: WRITTEN_WORKOUT };

/** Two trainees who differ in BOTH mechanisms, so either being misapplied is visible. */
const fast: Recipient = { athleteId: 'a', name: 'רות', offsetSec: -20, thresholdPaceSec: 240 };
const slow: Recipient = { athleteId: 'b', name: 'דני', offsetSec: 30, thresholdPaceSec: 360 };

function repOf(workout: ParsedWorkout) {
  return workout.steps[0].repeatSteps![0];
}

describe('a book slot is resolved, never repaced', () => {
  it('derives each trainee from their own test and nothing else', () => {
    const slots = { 2: BOOK };
    const forFast = repOf(materialiseWeek(slots, fast).workouts[0]);
    const forSlow = repOf(materialiseWeek(slots, slow).workouts[0]);

    // What the entry means, resolved directly: the offsets must not appear anywhere in it.
    const straight = (thresholdPaceSec: number) =>
      repOf(resolveLibraryWorkout({ name: 'x', notes: null, steps: REPS }, { thresholdPaceSec, dayOfWeek: 2 })!);
    expect(forFast.targetPaceMinPerKm).toBe(straight(240).targetPaceMinPerKm);
    expect(forSlow.targetPaceMinPerKm).toBe(straight(360).targetPaceMinPerKm);
  });

  it('does not produce what a doubly-applied week would produce', () => {
    // The defect, written out: resolve against the FIRST trainee, then let the old mechanism
    // repace it for the second. This is the value that must not appear.
    const resolvedForFast = resolveLibraryWorkout({ name: 'x', notes: null, steps: REPS }, { thresholdPaceSec: 240, dayOfWeek: 2 })!;
    const doubled = repOf(repaceWeek([resolvedForFast], slow.offsetSec)[0]);
    const correct = repOf(materialiseWeek({ 2: BOOK }, slow).workouts[0]);
    expect(correct.targetPaceMinPerKm).not.toBe(doubled.targetPaceMinPerKm);
    // And by a wide margin, not a rounding difference: 240 vs 360 sec/km of threshold is two
    // different runners, so nobody would read the wrong number as a near miss.
    expect(Math.abs(correct.targetPaceMinPerKm! - doubled.targetPaceMinPerKm!)).toBeGreaterThan(60);
  });

  it('leaves the recovery note alone', () => {
    // `shiftPacesInNotes` would rewrite `2:00 הליכה` as a pace if a book step ever reached it.
    const rest = materialiseWeek({ 2: BOOK }, slow).workouts[0].steps[0].repeatSteps![1];
    expect(rest.notes).toBe('2:00 הליכה');
  });
});

describe('a written slot keeps the mechanism it already had', () => {
  it('shifts the author’s paces by the offset, per trainee', () => {
    expect(materialiseWeek({ 4: WRITTEN }, fast).workouts[0].steps[0].targetPaceMinPerKm).toBe(270);
    expect(materialiseWeek({ 4: WRITTEN }, slow).workouts[0].steps[0].targetPaceMinPerKm).toBe(320);
  });

  it('is not touched by the threshold test', () => {
    // A trainee with a test and no band still gets the coach's paces as written — the test
    // says nothing about a workout that was never expressed as a share of it.
    const noBand: Recipient = { ...slow, offsetSec: null };
    const out = materialiseWeek({ 4: WRITTEN }, noBand);
    expect(out.workouts[0].steps[0].targetPaceMinPerKm).toBe(290);
    // And the watch does not alarm on somebody else's target.
    expect(out.paceAlerts).toBe(false);
  });
});

describe('a mixed week', () => {
  const slots = { 2: BOOK, 4: WRITTEN };

  it('applies each mechanism to its own day', () => {
    const out = materialiseWeek(slots, slow);
    expect(out.workouts).toHaveLength(2);
    expect(repOf(out.workouts[0]).targetPaceMinPerKm).toBe(repOf(materialiseWeek({ 2: BOOK }, slow).workouts[0]).targetPaceMinPerKm);
    expect(out.workouts[1].steps[0].targetPaceMinPerKm).toBe(320);
    expect(out.paceAlerts).toBe(true);
  });

  it('numbers the days from the slot, not from the workout it was authored as', () => {
    // The written fixture says Thursday. Dropped on Sunday it is a Sunday workout, and
    // `workout_deliveries` is keyed by date.
    expect(materialiseWeek({ 0: WRITTEN }, slow).workouts[0].dayOfWeek).toBe(0);
    expect(materialiseWeek(slots, slow).workouts.map(w => w.dayOfWeek)).toEqual([2, 4]);
  });

  it('drops the book day for a trainee with no usable test, and names it', () => {
    const untested: Recipient = { ...slow, thresholdPaceSec: null };
    const out = materialiseWeek(slots, untested);
    // The written day still goes out. Refusing the whole week over one missing test would
    // punish the trainee for the coach's choice of a book entry on another day.
    expect(out.workouts.map(w => w.dayOfWeek)).toEqual([4]);
    expect(out.skipped).toEqual([{ dayOfWeek: 2, entryId: 'l1', name: 'אינטרוולים קלאסי', reason: 'no-test' }]);
    expect(out.paceAlerts).toBe(false);
  });
});

describe('what the composer needs before it pushes', () => {
  it('names the book entries once, however many days use them', () => {
    expect(bookEntryIds({ 2: BOOK, 4: BOOK, 5: WRITTEN })).toEqual(['l1']);
    expect(bookEntryIds({ 4: WRITTEN })).toEqual([]);
  });

  it('separates a missing test from a missing band', () => {
    expect(weekGaps({ 2: BOOK }, slow)).toEqual({ needsTest: false, needsBand: false, empty: false });
    expect(weekGaps({ 2: BOOK }, { ...slow, thresholdPaceSec: null }))
      .toEqual({ needsTest: true, needsBand: false, empty: true });
    // A band is a warning, never a blocker: this is what the composer did before the book.
    expect(weekGaps({ 4: WRITTEN }, { ...slow, offsetSec: null }))
      .toEqual({ needsTest: false, needsBand: true, empty: false });
    // A mixed week for an untested trainee is not empty — one day survives.
    expect(weekGaps({ 2: BOOK, 4: WRITTEN }, { ...slow, thresholdPaceSec: null }).empty).toBe(false);
  });

  it('treats a threshold of zero as no test at all', () => {
    // `thresholdPaceSec` returns a number off a test row, and a test row can be wrong.
    const zero: Recipient = { ...slow, thresholdPaceSec: 0 };
    expect(weekGaps({ 2: BOOK }, zero).needsTest).toBe(true);
    expect(materialiseWeek({ 2: BOOK }, zero).skipped).toHaveLength(1);
  });
});
