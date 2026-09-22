import { describe, expect, it } from 'vitest';
import { isPlanNote, nameQualifier, roundKm, weekChart, weekStats } from '@/lib/plans/week-summary';
import { formatDurationClock } from '@/lib/workout-duration';
import type { WeekSession } from '@/lib/plans/workout-parsing';

const session = (o: Partial<WeekSession> & { dayOfWeek: number; kmMax: number }): WeekSession => ({
  key: `day-${o.dayOfWeek}-part-${o.partIndex ?? 1}`,
  name: '',
  type: 'easy',
  kind: null,
  kmFrom: 'coach',
  partIndex: 1,
  partCount: 1,
  optional: false,
  kmMin: o.kmMax,
  durationSec: 3600,
  steps: [],
  ...o,
});

// The real week of 2026-09-06: nine sessions on seven days, two of them optional
// evenings, the longest single session Friday's 32 km.
const WEEK: WeekSession[] = [
  session({ dayOfWeek: 0, kmMin: 23, kmMax: 24, type: 'long_run', durationSec: 6420 }),
  session({ dayOfWeek: 1, kmMin: 11, kmMax: 13, kind: 'morning', durationSec: 3600 }),
  session({ dayOfWeek: 1, kmMin: 0, kmMax: 0, kind: 'evening', optional: true, partIndex: 2, durationSec: 2100 }),
  session({ dayOfWeek: 2, kmMin: 23.6, kmMax: 24.5, type: 'intervals', kind: 'morning', durationSec: 6540 }),
  session({ dayOfWeek: 2, kmMin: 15.8, kmMax: 16.6, type: 'intervals', kind: 'evening', optional: true, partIndex: 2, durationSec: 4380 }),
  session({ dayOfWeek: 3, kmMin: 13, kmMax: 17, durationSec: 4500 }),
  session({ dayOfWeek: 4, kmMin: 13, kmMax: 15, type: 'intervals', durationSec: 4200 }),
  session({ dayOfWeek: 5, kmMin: 32, kmMax: 32, type: 'tempo', durationSec: 8880 }),
  session({ dayOfWeek: 6, kmMin: 8, kmMax: 11, durationSec: 3000 }),
];

describe('weekStats', () => {
  const stats = weekStats(WEEK);

  it('counts sessions and days separately', () => {
    // Nine sessions on seven days. The screen used to say "7", because a day
    // with two runs in it could only be counted once.
    expect(stats.sessionCount).toBe(9);
    expect(stats.dayCount).toBe(7);
  });

  it('reports the longest SESSION and the day it is on', () => {
    // Tuesday's two runs add to 41.1 km. Nobody runs 41 km on Tuesday, and the
    // week's longest run is Friday's 32.
    expect(stats.longestKm).toBe(32);
    expect(stats.longestDayOfWeek).toBe(5);
  });

  it('adds up without float garbage', () => {
    // Was 139.40000000000003 on screen.
    expect(stats.kmMin).toBe(139.4);
    expect(stats.kmMax).toBe(153.1);
  });

  it('separates out what is optional', () => {
    expect(stats.optionalKmMin).toBe(15.8);
    expect(stats.optionalKmMax).toBe(16.6);
    expect(stats.optionalDays).toEqual([1, 2]);
    // Monday's evening is a run with no distance at all, not the absence of one.
    expect(stats.hasKmlessSession).toBe(true);
  });

  it('orders the legend by the palette, not by the calendar', () => {
    expect(stats.types).toEqual(['long_run', 'intervals', 'tempo', 'easy']);
  });

  it('answers for an empty week', () => {
    const empty = weekStats([]);
    expect(empty.sessionCount).toBe(0);
    expect(empty.longestDayOfWeek).toBe(-1);
    expect(empty.types).toEqual([]);
  });
});

describe('weekChart', () => {
  const columns = weekChart(WEEK, { heightPx: 80 });

  it('draws seven columns whatever the week holds', () => {
    expect(columns).toHaveLength(7);
    expect(columns.map((c) => c.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('gives every session its own segment', () => {
    expect(columns[2].segments).toHaveLength(2);
    expect(columns[2].multi).toBe(true);
    expect(columns[0].segments).toHaveLength(1);
    expect(columns[0].multi).toBe(false);
  });

  it('keeps the tallest stack inside the box', () => {
    // Tuesday is the heaviest day (24.5 + 16.6), so it sets the scale and lands
    // on the full height. Scaling on the longest SESSION instead put it at 103px
    // in an 80px chart.
    const tuesday = columns[2].segments.reduce((sum, s) => sum + s.heightPx, 0);
    expect(tuesday).toBeLessThanOrEqual(80);
    expect(tuesday).toBeGreaterThan(70);
    for (const col of columns) {
      const stack = col.segments.reduce((sum, s) => sum + s.heightPx, 0);
      expect(stack).toBeLessThanOrEqual(80);
    }
  });

  it('still draws a session that has no distance', () => {
    const monday = columns[1].segments;
    expect(monday).toHaveLength(2);
    expect(monday[1].heightPx).toBeGreaterThan(0);
    expect(monday[1].optional).toBe(true);
  });

  it('leaves a rest day empty', () => {
    const [rest] = weekChart([session({ dayOfWeek: 3, kmMax: 10 })], { heightPx: 80 });
    expect(rest.hasWorkout).toBe(false);
    expect(rest.segments).toEqual([]);
  });
});

/**
 * "יום שני לדוגמא אין אימון / הגרף צריך להיות ריק עבור אותו יום" (bd468327).
 *
 * The real week of 2026-09-20: Yom Kippur fell on the Monday and the coach wrote
 * "כיפור – אין אימון מתוכנן" there. The parser has one shape for a published day,
 * so it arrived as a session — and the screen believed it: a stub bar on the
 * chart, "8 workouts · 7 days" above it, and a tappable row reading "0 min".
 */
const NOTE_WEEK: WeekSession[] = [
  session({ dayOfWeek: 0, kmMin: 20, kmMax: 21, type: 'intervals', durationSec: 5400 }),
  session({ dayOfWeek: 1, kmMin: 0, kmMax: 0, durationSec: 0, name: 'שני' }),
  session({ dayOfWeek: 3, kmMin: 12, kmMax: 14, durationSec: 4200 }),
];

describe('a day the coach marked as no-workout', () => {
  it('is not a session: no distance and no time', () => {
    expect(isPlanNote(NOTE_WEEK[1])).toBe(true);
    // The distinction that matters — an option with no km still has its minutes.
    expect(isPlanNote({ kmMax: 0, durationSec: 2100 })).toBe(false);
    expect(isPlanNote({ kmMax: 13, durationSec: 3600 })).toBe(false);
  });

  it('leaves the column empty', () => {
    const columns = weekChart(NOTE_WEEK, { heightPx: 80 });
    expect(columns[1].segments).toEqual([]);
    expect(columns[1].hasWorkout).toBe(false);
    // And the days that DO hold a workout are untouched by it.
    expect(columns[0].segments).toHaveLength(1);
    expect(columns[3].segments).toHaveLength(1);
  });

  it('is not counted as a workout or as a training day', () => {
    const stats = weekStats(NOTE_WEEK);
    expect(stats.sessionCount).toBe(2);
    expect(stats.dayCount).toBe(2);
    expect(stats.noteDays).toEqual([1]);
    // It has no distance, so it must not drag the week's total or the legend
    // with it either — the colour of a bar nobody draws.
    expect(stats.kmMax).toBe(35);
    expect(stats.types).toEqual(['intervals', 'easy']);
    expect(stats.hasKmlessSession).toBe(false);
  });

  it('still leaves the real kmless evening its stub and its count', () => {
    // The whole WEEK fixture: Monday's optional evening is a run with no distance
    // and 35 minutes. It is a session, and this fix may not take it away.
    const stats = weekStats(WEEK);
    expect(stats.sessionCount).toBe(9);
    expect(stats.noteDays).toEqual([]);
    expect(stats.hasKmlessSession).toBe(true);
    expect(weekChart(WEEK, { heightPx: 80 })[1].segments).toHaveLength(2);
  });
});

describe('nameQualifier', () => {
  const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  it('keeps what the coach actually named the session', () => {
    // The one word on Friday that says what the session is. Dropping it is how a
    // 32 km Italian medio came to read as a plain "20 km".
    expect(nameQualifier('יום שישי - ITALIAN MEDIO', HE_DAYS)).toBe('ITALIAN MEDIO');
  });

  it('is empty when the name is only the day', () => {
    expect(nameQualifier('יום ראשון', HE_DAYS)).toBe('');
    expect(nameQualifier('שבת', HE_DAYS)).toBe('');
  });

  it('drops what the badges beside it already say', () => {
    expect(nameQualifier('יום שלישי - בוקר', HE_DAYS)).toBe('');
    expect(nameQualifier('יום שני - ערב אופציה', HE_DAYS)).toBe('');
  });

  it('survives a name with no day in it', () => {
    expect(nameQualifier('Hill repeats', HE_DAYS)).toBe('Hill repeats');
    expect(nameQualifier('', HE_DAYS)).toBe('');
  });
});

describe('roundKm', () => {
  it('is what keeps "39.400000000000006" off the screen', () => {
    expect(roundKm(23.65 + 15.75)).toBe(39.4);
    expect(roundKm(0)).toBe(0);
  });
});

describe('formatDurationClock', () => {
  it('lines up in a column', () => {
    expect(formatDurationClock(6420)).toBe('1:47');
    expect(formatDurationClock(3000)).toBe('0:50');
    expect(formatDurationClock(8880)).toBe('2:28');
  });

  it('rounds to minutes before splitting', () => {
    expect(formatDurationClock(3599)).toBe('1:00');
    expect(formatDurationClock(0)).toBe('');
  });
});
