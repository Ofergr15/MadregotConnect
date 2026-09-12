import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  activityWeekOfPlanWeek,
  addDaysToDateStr,
  formatWeekRange,
  getActivityWeekStart,
  getPlanWeekStart,
  planWeekStartOf,
  shiftWeekStart,
  toISODate,
} from '@/lib/utils';

// Regression coverage for a real bug: these helpers used to serialize via
// `d.toISOString().split('T')[0]`, which re-expresses the local Sunday in UTC
// first — silently rolling it back to Saturday for ~2-3 hours right after
// local midnight in a positive-UTC-offset timezone like Israel (IDT, UTC+3).
describe('getPlanWeekStart / getActivityWeekStart (Asia/Jerusalem)', () => {
  const originalTZ = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'Asia/Jerusalem'; });
  afterAll(() => { process.env.TZ = originalTZ; });

  it('returns the correct week start just after local midnight, not the previous day', () => {
    // Each helper tested on its OWN first day, at 00:30 IDT — the window where
    // serializing through UTC used to roll the date back to the day before.
    // 2026-08-23 is a Sunday, 2026-08-24 the Monday after it.
    expect(getPlanWeekStart(new Date('2026-08-23T00:30:00+03:00'))).toBe('2026-08-23');
    expect(getActivityWeekStart(new Date('2026-08-24T00:30:00+03:00'))).toBe('2026-08-24');
  });

  it('returns the same Sunday later the same day', () => {
    const afternoon = new Date('2026-08-23T14:00:00+03:00');
    expect(getPlanWeekStart(afternoon)).toBe('2026-08-23');
  });

  it('returns the prior Sunday for a mid-week date', () => {
    const wednesday = new Date('2026-08-26T10:00:00+03:00');
    expect(getPlanWeekStart(wednesday)).toBe('2026-08-23');
  });
});

// ── The two anchors are DIFFERENT, and that is load-bearing ───────────────────
// The club plans Sunday–Saturday; watches report Monday–Sunday. They were merged
// onto Sunday on 2026-08-21 and re-split on 2026-09-09, because an athlete whose
// watch said 180 km read 174.5 in the app for the same runs and reported it as a
// bug. Both numbers were right, which is why nobody could reconcile them.
//
// These assertions exist so a future "why are there two of these?" tidy-up fails
// here instead of in production, where the symptom is a weekly km that silently
// reads 0 (an activity-week key compared against a plan-week key never matches).
describe('getActivityWeekStart vs getPlanWeekStart', () => {
  const originalTZ = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'Asia/Jerusalem'; });
  afterAll(() => { process.env.TZ = originalTZ; });

  it('anchors the activity week on Monday and the plan week on Sunday', () => {
    for (let i = 0; i < 28; i++) {
      const day = new Date(`${addDaysToDateStr('2026-08-01', i)}T12:00:00`);
      expect(new Date(`${getActivityWeekStart(day)}T12:00:00`).getDay()).toBe(1);
      expect(new Date(`${getPlanWeekStart(day)}T12:00:00`).getDay()).toBe(0);
    }
  });

  it('agrees for six days a week and splits on the Sunday', () => {
    // Mon–Sat: the activity week is the Monday inside the plan week, so the pair
    // straddles the same days. Sunday is the day they name different weeks — the
    // plan week starts, the activity week is still the one that closes tonight.
    expect(getActivityWeekStart(new Date('2026-08-26T12:00:00'))).toBe('2026-08-24'); // Wed
    expect(getPlanWeekStart(new Date('2026-08-26T12:00:00'))).toBe('2026-08-23');
    expect(getActivityWeekStart(new Date('2026-08-30T12:00:00'))).toBe('2026-08-24'); // Sun
    expect(getPlanWeekStart(new Date('2026-08-30T12:00:00'))).toBe('2026-08-30');
  });

  it('maps a plan week to the activity week that overlaps it by six days', () => {
    // Not the Monday BEFORE the plan week's Sunday, which would share one day.
    expect(activityWeekOfPlanWeek('2026-08-23')).toBe('2026-08-24');
    expect(activityWeekOfPlanWeek('2026-08-30')).toBe('2026-08-31');
    // Whatever it is handed, the answer is a Monday.
    for (let i = 0; i < 8; i++) {
      const planWeek = planWeekStartOf(addDaysToDateStr('2026-09-01', i * 7));
      expect(new Date(`${activityWeekOfPlanWeek(planWeek)}T12:00:00`).getDay()).toBe(1);
    }
  });
});

describe('toISODate', () => {
  it('formats using local calendar fields, not a UTC-shifted one', () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = 'Asia/Jerusalem';
    expect(toISODate(new Date('2026-08-23T00:30:00+03:00'))).toBe('2026-08-23');
    process.env.TZ = originalTZ;
  });
});

// ── The one week helper everything should call ────────────────────────────────
// This replaced SEVEN hand-rolled copies: five `sundayOf` (lib/academy/report,
// api/academy/segments, AcademyPlanComposer, AcademyCompliance,
// components/academy/types) and two `getCurrentWeekSunday` (dashboard/plan/new,
// dashboard/activities). The two families disagreed — the `sundayOf` ones read the
// UTC calendar date, which between 00:00 and 03:00 in Israel is still yesterday,
// so at 00:30 on a Sunday the academy screens sat on last week while the planner
// and the activities page sat on this one. Same bug the top of this file describes,
// reintroduced five times by copies written before the shared helpers existed.
describe('planWeekStartOf', () => {
  it('resolves the Sunday of a bare YYYY-MM-DD', () => {
    expect(planWeekStartOf('2026-08-26')).toBe('2026-08-23'); // a Wednesday
    expect(planWeekStartOf('2026-08-23')).toBe('2026-08-23'); // the Sunday itself
    expect(planWeekStartOf('2026-08-29')).toBe('2026-08-23'); // Saturday ends the week
    expect(planWeekStartOf('2026-08-30')).toBe('2026-08-30'); // next Sunday starts a new one
  });

  it('reads a bare date as a calendar date in any process timezone', () => {
    // A YYYY-MM-DD carries no timezone, so it must not be re-resolved through one.
    const originalTZ = process.env.TZ;
    for (const tz of ['UTC', 'Asia/Jerusalem', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = tz;
      expect(planWeekStartOf('2026-08-30')).toBe('2026-08-30');
      expect(planWeekStartOf('2026-08-29')).toBe('2026-08-23');
    }
    process.env.TZ = originalTZ;
  });

  it('puts the small hours of an Israeli Sunday in THIS week, not last', () => {
    // The regression. 2026-08-30 00:30 IDT is 2026-08-29 21:30 UTC — a Saturday by
    // the UTC calendar — and the old copies therefore answered 2026-08-23.
    expect(planWeekStartOf(new Date('2026-08-30T00:30:00+03:00'))).toBe('2026-08-30');
    expect(planWeekStartOf(new Date('2026-08-29T21:30:00Z'))).toBe('2026-08-30');
  });

  it('still ends the week on Saturday night', () => {
    // Late Saturday in Israel belongs to the week that is closing, not the next.
    expect(planWeekStartOf(new Date('2026-08-29T23:30:00+03:00'))).toBe('2026-08-23');
  });

  it('answers for Israel regardless of where it runs', () => {
    // The instant is fixed; a UTC server and an Israeli phone must not disagree.
    const originalTZ = process.env.TZ;
    const instant = new Date('2026-08-29T21:30:00Z');
    for (const tz of ['UTC', 'Asia/Jerusalem', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      expect(planWeekStartOf(instant)).toBe('2026-08-30');
    }
    process.env.TZ = originalTZ;
  });

  it('accepts a full ISO timestamp as an instant', () => {
    expect(planWeekStartOf('2026-08-29T21:30:00Z')).toBe('2026-08-30');
  });

  it('falls back to the current week for null, undefined or an empty string', () => {
    const now = planWeekStartOf(new Date());
    expect(planWeekStartOf()).toBe(now);
    expect(planWeekStartOf(null)).toBe(now);
    expect(planWeekStartOf('')).toBe(now);
  });

  it('always returns a Sunday', () => {
    // 60 consecutive days, every one of which must land on a Sunday.
    for (let i = 0; i < 60; i++) {
      const start = planWeekStartOf(addDaysToDateStr('2026-08-01', i));
      expect(new Date(`${start}T12:00:00Z`).getUTCDay()).toBe(0);
    }
  });
});

describe('shiftWeekStart / addDaysToDateStr', () => {
  it('shifts whole weeks in both directions across a month boundary', () => {
    expect(shiftWeekStart('2026-08-30', 1)).toBe('2026-09-06');
    expect(shiftWeekStart('2026-09-06', -1)).toBe('2026-08-30');
    expect(shiftWeekStart('2026-08-23', 0)).toBe('2026-08-23');
  });

  it('crosses a year boundary', () => {
    expect(shiftWeekStart('2026-12-27', 1)).toBe('2027-01-03');
    expect(shiftWeekStart('2027-01-03', -1)).toBe('2026-12-27');
  });

  it('keeps landing on a Sunday however far it shifts', () => {
    for (const weeks of [-52, -5, -1, 1, 5, 52]) {
      const out = shiftWeekStart('2026-08-23', weeks);
      expect(new Date(`${out}T12:00:00Z`).getUTCDay()).toBe(0);
    }
  });

  it('does not lose a day across the Israeli DST switch', () => {
    // Clocks go back on 2026-10-25; a midnight-anchored date would slip to the
    // 24th. Noon leaves twelve hours of slack in both directions.
    const originalTZ = process.env.TZ;
    process.env.TZ = 'Asia/Jerusalem';
    expect(addDaysToDateStr('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDaysToDateStr('2026-10-25', 1)).toBe('2026-10-26');
    expect(shiftWeekStart('2026-10-18', 1)).toBe('2026-10-25');
    // And forward, over the spring switch (2027-03-26).
    expect(addDaysToDateStr('2027-03-26', 1)).toBe('2027-03-27');
    process.env.TZ = originalTZ;
  });

  it('walks days in both directions, including over month ends', () => {
    expect(addDaysToDateStr('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysToDateStr('2026-09-01', -1)).toBe('2026-08-31');
    expect(addDaysToDateStr('2026-08-23', 0)).toBe('2026-08-23');
    expect(addDaysToDateStr('2026-03-01', -1)).toBe('2026-02-28'); // 2026 is not a leap year
  });

  it('ignores a time appended to the date', () => {
    // The cron hands it a week start; a caller passing a full timestamp should not
    // silently get a shifted answer.
    expect(addDaysToDateStr('2026-08-23T23:00:00Z', 1)).toBe('2026-08-24');
  });

  it('is what the academy cron does to reach last week', () => {
    // `addDaysStr(sundayOf(null), -7)` in api/cron/academy-report.
    expect(addDaysToDateStr(planWeekStartOf('2026-08-30'), -7)).toBe('2026-08-23');
  });
});

// ── The range printed on screen ────────────────────────────────────────────────
// Report 66cd0d25: the feed said 99.2 km and the activities page said 123.3 km
// for "this week" — two correct totals over two different seven-day windows, and
// neither screen said which seven days it meant. Both now print the range, from
// one formatter, so the two can be told apart at a glance.
describe('formatWeekRange', () => {
  it('covers seven days ending six days after the start', () => {
    // A Monday-anchored activity week: Mon 7 Sep through Sun 13 Sep.
    expect(formatWeekRange('2026-09-07', 'en')).toBe('Sep 7 – Sep 13');
    // The Sunday plan week that overlaps it by six days is a DIFFERENT range,
    // which is the whole point of printing it.
    expect(formatWeekRange('2026-09-06', 'en')).toBe('Sep 6 – Sep 12');
  });

  it('crosses a month end', () => {
    expect(formatWeekRange('2026-08-31', 'en')).toBe('Aug 31 – Sep 6');
  });

  it('accepts a week start with a time appended', () => {
    expect(formatWeekRange('2026-09-07T00:00:00Z', 'en')).toBe('Sep 7 – Sep 13');
  });

  it('formats in Hebrew for the he locale', () => {
    // Not asserting the exact month abbreviation (that's ICU's to change) — only
    // that the locale reaches Intl at all and the two ends differ.
    const range = formatWeekRange('2026-09-07', 'he');
    expect(range).toContain('–');
    expect(range).toMatch(/7/);
    expect(range).toMatch(/13/);
  });
});
