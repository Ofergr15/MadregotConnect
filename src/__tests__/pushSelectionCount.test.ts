import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import {
  planDaysOf,
  selectedDayCountOf,
  selectedWorkoutCount,
} from '@/lib/plans/push-selection';

/**
 * "יקבלו 8 אימונים" ON A SHEET THAT WAS SENDING ONE (feedback 52320d01).
 *
 * "לא ברור למה כתוב יקבלו 8 אימונים / שלחתי פה אימון אחד 1 - רק את אימון של יום א"
 *
 * The send sheet showed both numbers at the same time: the day-picker line said
 * "שולח 1 אימון(ים) לכל ספורטאי" (right — only Sunday was picked) and the roster
 * headline said "16 מחוברים ל-Garmin · יקבלו 8 אימון(ים)" (the size of the parsed
 * plan, ignoring the picker entirely). Nothing was sent wrongly; the sheet just
 * described the send wrongly, in the sentence that says what the athletes get.
 */

/** A week with two two-a-days: Sunday ×1, Tuesday ×2, Thursday ×1, Saturday ×2. */
const WEEK = [
  { dayOfWeek: 0 },
  { dayOfWeek: 2 },
  { dayOfWeek: 2 },
  { dayOfWeek: 4 },
  { dayOfWeek: 6 },
  { dayOfWeek: 6 },
];

describe('what the Garmin push sheet says it will send', () => {
  it('counts the sessions the picked days hold, not the whole plan', () => {
    // The reported bug, in one assertion: Sunday picked out of a 6-session week.
    expect(selectedWorkoutCount(WEEK, [0])).toBe(1);
    expect(selectedWorkoutCount(WEEK, null)).toBe(6);
  });

  it('counts a two-a-day as two workouts, because that is two files', () => {
    expect(selectedWorkoutCount(WEEK, [2])).toBe(2);
    expect(selectedDayCountOf(WEEK, [2])).toBe(1);
    // Which is exactly why the two counts may not be swapped for each other.
    expect(selectedWorkoutCount(WEEK, [2])).not.toBe(selectedDayCountOf(WEEK, [2]));
  });

  it('offers a chip only for days that hold a session', () => {
    expect(planDaysOf(WEEK)).toEqual([0, 2, 4, 6]);
    expect(planDaysOf([])).toEqual([]);
  });

  it('ignores a picked day the plan no longer has', () => {
    // A re-parse can drop a day while it is still selected. The button must not
    // promise it, and nothing is sent for it either.
    expect(selectedDayCountOf(WEEK, [0, 5])).toBe(1);
    expect(selectedWorkoutCount(WEEK, [0, 5])).toBe(1);
  });

  it('says nothing is going out when nothing is picked', () => {
    expect(selectedWorkoutCount(WEEK, [])).toBe(0);
    expect(selectedDayCountOf(WEEK, [])).toBe(0);
  });

  it('feeds the sheet both counts from the selection, never from the plan size', () => {
    const src = readFileSync(
      join(fileURLToPath(new URL('../', import.meta.url)), 'app/(app)/dashboard/plan/new/page.tsx'),
      'utf8'
    );
    // Both "workouts" sentences on the sheet, and they must agree by construction.
    expect(src).toMatch(/t\('sendingWorkouts', \{ count: selectedWorkoutCount \}\)/);
    expect(src).toMatch(/t\('garminWillReceive', \{ ready: readyCount, count: selectedWorkoutCount \}\)/);
    // `workoutCount` is the parsed plan's size and belongs to the plan summary
    // card only. Handing it to the sheet again is the regression.
    expect(src).not.toMatch(/garminWillReceive[^)]*count: workoutCount/);
  });
});
