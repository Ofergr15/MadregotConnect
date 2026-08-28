import { describe, expect, it } from 'vitest';
import {
  activityLocalDateStr,
  activityLocalDay,
  activityLocalHour,
  activityWeekStart,
  computeWeekStreak,
  formatActivityTime,
  getActivityWeekStart,
  israelDateAnchor,
  israelNow,
  israelToday,
} from '@/lib/utils';

// The whole club is in Israel; every server this runs on has a UTC clock. These
// tests pin down the two windows where that difference is visible.
describe('israelToday', () => {
  it('is already tomorrow in Israel late on a UTC evening', () => {
    // 22:30 UTC on the 27th = 01:30 on the 28th in Israel (IDT, UTC+3).
    expect(israelToday(new Date('2026-08-27T22:30:00Z'))).toBe('2026-08-28');
  });

  it('agrees with UTC during the day', () => {
    expect(israelToday(new Date('2026-08-27T09:00:00Z'))).toBe('2026-08-27');
  });

  it('follows the DST offset rather than a fixed +3', () => {
    // Winter (IST, UTC+2): 22:30Z is still the same day; summer it isn't.
    expect(israelToday(new Date('2026-01-15T22:30:00Z'))).toBe('2026-01-16');
    expect(israelToday(new Date('2026-01-15T21:30:00Z'))).toBe('2026-01-15');
    expect(israelToday(new Date('2026-07-15T21:30:00Z'))).toBe('2026-07-16');
  });
});

describe('israelDateAnchor', () => {
  it('lands on Israel’s calendar day at local noon', () => {
    const anchor = israelDateAnchor(new Date('2026-08-27T22:30:00Z'));
    expect(anchor.getFullYear()).toBe(2026);
    expect(anchor.getMonth()).toBe(7); // August
    expect(anchor.getDate()).toBe(28);
    expect(anchor.getHours()).toBe(12);
  });

  // This is the bug the anchor exists to kill: at 00:30 Israel on a Sunday the
  // raw instant is still Saturday in UTC, so on Vercel getActivityWeekStart
  // returns the PREVIOUS week's Sunday and every weekly total reads a week
  // stale. Asserted only on the anchored value — the unanchored one is
  // deliberately not tested, since its answer depends on the machine's TZ
  // (that dependence IS the bug).
  it('keeps the week from slipping backwards just after Israeli midnight on a Sunday', () => {
    const justAfterMidnightSunday = new Date('2026-08-29T21:30:00Z'); // Sun 2026-08-30, 00:30 IDT
    expect(getActivityWeekStart(israelDateAnchor(justAfterMidnightSunday))).toBe('2026-08-30');
  });

  it('is a no-op for a mid-day instant', () => {
    expect(getActivityWeekStart(israelDateAnchor(new Date('2026-08-26T09:00:00Z')))).toBe('2026-08-23');
  });
});

// Activity start_time is the athlete's wall-clock stored as if UTC, so week
// bucketing must use UTC parts — otherwise a late Saturday run shifts into
// Sunday and lands in the wrong week for anyone viewing from Israel.
describe('activityWeekStart', () => {
  it('keeps a late Saturday run in the week that is ending', () => {
    expect(activityWeekStart('2026-08-29T21:30:00')).toBe('2026-08-23');
  });

  it('puts an early Sunday run in the week that just started', () => {
    expect(activityWeekStart('2026-08-30T06:15:00')).toBe('2026-08-30');
  });

  // All four forms that actually flow through the app must agree, whatever the
  // viewer's timezone: Postgres returns the +00:00 form, the Garmin sync writes
  // the space-separated one with no offset at all.
  it('reads every timestamp shape as the same instant', () => {
    for (const form of [
      '2026-08-30T00:00:00',
      '2026-08-30T00:00:00Z',
      '2026-08-30 00:00:00',
      '2026-08-30T00:00:00+00:00',
    ]) {
      expect(activityWeekStart(form)).toBe('2026-08-30');
    }
  });
});

describe('activity-local accessors', () => {
  // A 06:01 run must read as 06:01 for the athlete regardless of the shape of
  // the string or where it's viewed from — an offsetless string used to be
  // parsed as local time and come back as 03:01 in an Israel browser.
  it('reports the athlete’s own wall-clock hour for every timestamp shape', () => {
    for (const form of [
      '2026-07-12T06:01:40',
      '2026-07-12 06:01:40',
      '2026-07-12T06:01:40Z',
      '2026-07-12T06:01:40+00:00',
    ]) {
      expect(activityLocalHour(form)).toBe(6);
      expect(activityLocalDateStr(form)).toBe('2026-07-12');
      expect(activityLocalDay(form)).toBe(0); // Sunday
      expect(formatActivityTime(form)).toBe('6:01 AM');
    }
  });

  it('keeps a late-evening run on its own day', () => {
    expect(activityLocalDateStr('2026-07-12 22:45:00')).toBe('2026-07-12');
    expect(activityLocalHour('2026-07-12 22:45:00')).toBe(22);
  });
});

describe('computeWeekStreak', () => {
  const now = new Date('2026-08-26T09:00:00Z'); // Wed, week of 2026-08-23

  it('counts back consecutive weeks from the current one', () => {
    expect(computeWeekStreak(new Set(['2026-08-23', '2026-08-16', '2026-08-09']), now)).toBe(3);
  });

  it('stops at the first gap', () => {
    expect(computeWeekStreak(new Set(['2026-08-23', '2026-08-09']), now)).toBe(1);
  });

  it('does not reset to zero early in a week with no run yet', () => {
    expect(computeWeekStreak(new Set(['2026-08-16', '2026-08-09']), now)).toBe(2);
  });

  it('is zero with no history', () => {
    expect(computeWeekStreak(new Set(), now)).toBe(0);
  });

  // Anchoring inside computeWeekStreak means this instant — Saturday in UTC,
  // Sunday in Israel — counts the new week, not the old one.
  it('anchors to the Israeli day rather than the raw instant', () => {
    const sundayInIsrael = new Date('2026-08-29T21:30:00Z');
    expect(computeWeekStreak(new Set(['2026-08-30']), sundayInIsrael)).toBe(1);
  });
});

describe('israelNow', () => {
  it('reports Israeli wall-clock hour and weekday', () => {
    const parts = israelNow(new Date('2026-08-29T21:30:00Z'));
    expect(parts.hour).toBe(0);
    expect(parts.minute).toBe(30);
    expect(parts.weekday).toBe(0); // Sunday
  });

  it('reports the winter offset correctly', () => {
    expect(israelNow(new Date('2026-01-15T06:00:00Z')).hour).toBe(8);
  });
});
