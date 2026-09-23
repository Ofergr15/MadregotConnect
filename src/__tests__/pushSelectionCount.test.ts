import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import {
  dayMapChanges,
  planDaysOf,
  remapForAthlete,
  selectedDayCountOf,
  selectedSessions,
  selectedWorkoutCount,
  sessionSlot,
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

/** The same week with names, for the "which workout" and custom-week parts. */
const NAMED = [
  { dayOfWeek: 0, name: 'ריצה קלה 8 ק״מ', workoutKey: 'day-0-part-1-single' },
  { dayOfWeek: 2, name: 'אינטרוולים 6×400', workoutKey: 'day-2-part-1-morning', partIndex: 1, partCount: 2 },
  { dayOfWeek: 2, name: 'שחייה', workoutKey: 'day-2-part-2-evening', partIndex: 2, partCount: 2 },
  { dayOfWeek: 3, name: 'טמפו 5 ק״מ', workoutKey: 'day-3-part-1-single' },
  { dayOfWeek: 6, name: 'ארוכה 18 ק״מ', workoutKey: 'day-6-part-1-single' },
];

describe('which workouts the sheet is about to send', () => {
  it('names them in the order the week runs, two-a-days in part order', () => {
    expect(selectedSessions(NAMED, null).map((w) => w.name)).toEqual([
      'ריצה קלה 8 ק״מ', 'אינטרוולים 6×400', 'שחייה', 'טמפו 5 ק״מ', 'ארוכה 18 ק״מ',
    ]);
  });

  it('names only the picked days', () => {
    expect(selectedSessions(NAMED, [2]).map((w) => w.name)).toEqual(['אינטרוולים 6×400', 'שחייה']);
    expect(selectedSessions(NAMED, [])).toEqual([]);
  });

  it('does not reorder the caller\'s array in place', () => {
    const before = NAMED.map((w) => w.name);
    selectedSessions(NAMED, null);
    expect(NAMED.map((w) => w.name)).toEqual(before);
  });
});

describe('a custom week for one athlete', () => {
  it("sends Wednesday's workout as their Monday", () => {
    // The ask, literally: Ofer needs Wednesday's session on Monday. The delivery
    // date is weekStartDate + dayOfWeek, so rewriting the day is the whole fix.
    const mine = remapForAthlete(NAMED, { 'day-3-part-1-single': 1 });
    const moved = mine.find((w) => w.name === 'טמפו 5 ק״מ');
    expect(moved?.dayOfWeek).toBe(1);
    // Nobody else's day moved, and nothing was added or lost.
    expect(mine).toHaveLength(NAMED.length);
    expect(mine.filter((w) => w.name !== 'טמפו 5 ק״מ').map((w) => w.dayOfWeek)).toEqual([0, 2, 2, 6]);
  });

  it('leaves the plan itself untouched', () => {
    remapForAthlete(NAMED, { 'day-3-part-1-single': 1 });
    expect(NAMED.find((w) => w.name === 'טמפו 5 ק״מ')?.dayOfWeek).toBe(3);
  });

  it('drops a session that is explicitly not for them', () => {
    const mine = remapForAthlete(NAMED, { 'day-6-part-1-single': null });
    expect(mine.map((w) => w.name)).not.toContain('ארוכה 18 ק״מ');
    expect(mine).toHaveLength(NAMED.length - 1);
  });

  it('moves one half of a two-a-day without touching the other', () => {
    const mine = remapForAthlete(NAMED, { 'day-2-part-2-evening': 4 });
    expect(mine.find((w) => w.name === 'שחייה')?.dayOfWeek).toBe(4);
    expect(mine.find((w) => w.name === 'אינטרוולים 6×400')?.dayOfWeek).toBe(2);
  });

  it('is a no-op with no map, and hands back a copy either way', () => {
    expect(remapForAthlete(NAMED, null)).toEqual(NAMED);
    expect(remapForAthlete(NAMED, {})).toEqual(NAMED);
    expect(remapForAthlete(NAMED, null)).not.toBe(NAMED);
  });

  it('reports only what actually differs', () => {
    const changes = dayMapChanges(NAMED, {
      'day-3-part-1-single': 1,
      // Same day as the plan: not a change, and must not be listed as one.
      'day-0-part-1-single': 0,
      'day-6-part-1-single': null,
    });
    expect(changes.map((c) => [c.from, c.to])).toEqual([[3, 1], [6, null]]);
    expect(dayMapChanges(NAMED, null)).toEqual([]);
  });

  it('keys a session the same way across the three pace-group variants', () => {
    // The coach builds the map looking at one group; the athlete may be in another.
    const group3 = NAMED.map((w) => ({ ...w, name: `${w.name} (איטי)` }));
    expect(group3.map((w, i) => sessionSlot(w, i))).toEqual(NAMED.map((w, i) => sessionSlot(w, i)));
    expect(remapForAthlete(group3, { 'day-3-part-1-single': 1 })
      .find((w) => w.dayOfWeek === 1)?.name).toBe('טמפו 5 ק״מ (איטי)');
  });

  it('falls back to a positional key for a plan saved before keys existed', () => {
    const old = [{ dayOfWeek: 3, name: 'טמפו' }];
    const slot = sessionSlot(old[0], 0);
    expect(slot).toBe('slot-3-1');
    expect(remapForAthlete(old, { [slot]: 1 })[0].dayOfWeek).toBe(1);
  });
});

describe('the send path uses one batching rule for pushes and retries', () => {
  const src = readFileSync(
    join(fileURLToPath(new URL('../', import.meta.url)), 'app/(app)/dashboard/plan/new/page.tsx'),
    'utf8'
  );

  it('retries through pushToAthletes instead of rebuilding a group-1 payload', () => {
    // The retry used to post groupedPlans.group1 for every failed athlete, so a
    // group-3 athlete was retried with group-1 paces on their watch.
    expect(src).toMatch(/const retryResults = await pushToAthletes\(/);
    expect(src).not.toMatch(/workouts: pushDays\s*\n?\s*\?\s*groupedPlans\.group1/);
  });

  it('sends a custom week as its own request, not inside a pace-group batch', () => {
    expect(src).toMatch(/athletes\.filter\(\(x\) => hasCustomWeek\(x\.id\)\)/);
    expect(src).toMatch(/remapForAthlete\(sessions, dayMaps\[a\.id\]\)/);
    expect(src).toMatch(/athletes\.filter\(\(x\) => !hasCustomWeek\(x\.id\)\)/);
  });
});
