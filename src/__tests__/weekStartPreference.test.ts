import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import {
  activityWeekStart,
  getActivityWeekStart,
  MONDAY_WEEK,
  SUNDAY_WEEK,
  weekStartDayOf,
  weekStartOn,
} from '@/lib/utils';
import { buildKmTable, computeLikeForLikeTrend } from '@/lib/athletes/profile-stats';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * A MEMBER'S OWN WEEK BOUNDARY (feedback 75cb7ec7, migration 119).
 *
 * Sahar: "the training week is shown as Monday to Sunday — can it be Monday to
 * Saturday?" The app anchors activity weeks on Monday because that is the week a
 * watch reports, and the club reads its calendar from Sunday. Both are right, so
 * the member picks — and the choice moves the numbers on their own profile only.
 *
 * The rule these tests exist to hold: ANYTHING THAT RANKS PEOPLE STAYS ON MONDAY.
 * A leaderboard that measured twenty-five members over twenty-five different
 * seven-day windows would not be a table, and the failure mode is silent — the
 * ordering just quietly stops meaning anything.
 */

describe('weekStartOn', () => {
  const originalTZ = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'Asia/Jerusalem'; });
  afterAll(() => { process.env.TZ = originalTZ; });

  // 2026-09-20 is a Sunday; 2026-09-21 the Monday after it.
  it('cuts the same day two ways, one per preference', () => {
    const wed = new Date('2026-09-23T09:00:00+03:00');
    expect(weekStartOn(wed, MONDAY_WEEK)).toBe('2026-09-21');
    expect(weekStartOn(wed, SUNDAY_WEEK)).toBe('2026-09-20');
  });

  it('puts a Sunday at the END of a Monday week and the START of a Sunday one', () => {
    // The whole point of the report: on Sunday the two conventions are a week
    // apart, not a day, which is why one of them has to be the reader's choice.
    const sun = new Date('2026-09-20T09:00:00+03:00');
    expect(weekStartOn(sun, MONDAY_WEEK)).toBe('2026-09-14');
    expect(weekStartOn(sun, SUNDAY_WEEK)).toBe('2026-09-20');
  });

  it('is what getActivityWeekStart already was', () => {
    // Monday-anchored behaviour is unchanged for everybody who never touches the
    // setting — the migration defaults to Monday for exactly this reason.
    for (const iso of ['2026-09-20', '2026-09-21', '2026-09-24', '2026-10-01']) {
      const d = new Date(`${iso}T12:00:00+03:00`);
      expect(weekStartOn(d, MONDAY_WEEK)).toBe(getActivityWeekStart(d));
    }
  });

  it('keeps activity keys in UTC parts so a late Saturday run stays in its week', () => {
    // 22:30 Saturday. Read through local getters in Israel this becomes Sunday
    // 01:30 and jumps a week — the bug activityWeekStart was written to avoid,
    // which the new argument must not reintroduce.
    const lateSat = '2026-09-26T22:30:00';
    expect(activityWeekStart(lateSat, MONDAY_WEEK)).toBe('2026-09-21');
    expect(activityWeekStart(lateSat, SUNDAY_WEEK)).toBe('2026-09-20');
  });

  it('defaults to Monday when nothing is passed', () => {
    expect(activityWeekStart('2026-09-20T09:00:00')).toBe('2026-09-14');
  });
});

describe('weekStartDayOf', () => {
  it('only ever answers 0 or 1', () => {
    expect(weekStartDayOf(0)).toBe(SUNDAY_WEEK);
    expect(weekStartDayOf(1)).toBe(MONDAY_WEEK);
  });

  it('falls back to Monday for anything else', () => {
    // Null, an absent column (119 not pasted yet) and a value the CHECK would
    // have refused all mean "leave this member's numbers exactly as they were".
    for (const v of [null, undefined, 3, 'sunday', {}, NaN]) {
      expect(weekStartDayOf(v)).toBe(MONDAY_WEEK);
    }
  });
});

describe('the km table', () => {
  const run = (start: string, km: number) => ({
    activity_type: 'running', start_time: start, distance: km * 1000, duration: km * 300,
  });

  // A Sunday run and a Saturday run: the two days the conventions disagree about.
  const acts = [
    run('2026-09-20T07:00:00', 10), // Sunday
    run('2026-09-22T07:00:00', 5),  // Tuesday
    run('2026-09-26T07:00:00', 20), // Saturday
  ];

  it('puts the Sunday and the Saturday in ONE week for a Sunday-week member', () => {
    const table = buildKmTable(acts, {
      limit: 2, currentWeekStart: '2026-09-20', startDay: SUNDAY_WEEK,
    });
    expect(table.find((r) => r.weekStart === '2026-09-20')?.km).toBe(35);
  });

  it('splits them for a Monday-week member', () => {
    // Sunday 09-20 belongs to the week that STARTED 09-14; the other two to 09-21.
    const table = buildKmTable(acts, {
      limit: 3, currentWeekStart: '2026-09-21', startDay: MONDAY_WEEK,
    });
    expect(table.find((r) => r.weekStart === '2026-09-14')?.km).toBe(10);
    expect(table.find((r) => r.weekStart === '2026-09-21')?.km).toBe(25);
  });

  it('is Monday-anchored when no preference is given', () => {
    const withArg = buildKmTable(acts, { limit: 3, currentWeekStart: '2026-09-21', startDay: MONDAY_WEEK });
    const without = buildKmTable(acts, { limit: 3, currentWeekStart: '2026-09-21' });
    expect(without).toEqual(withArg);
  });
});

describe('the trend badge', () => {
  const originalTZ = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'Asia/Jerusalem'; });
  afterAll(() => { process.env.TZ = originalTZ; });

  const run = (start: string, km: number) => ({
    activity_type: 'running', start_time: start, distance: km * 1000, duration: km * 300,
  });

  it('measures the elapsed part of the week from the reader\'s own first day', () => {
    // Anchor Tuesday 2026-09-22. For a Monday week that is day 2 of 7; for a
    // Sunday week, day 3. Getting that wrong truncates last week at the wrong
    // weekday, which is the one thing this badge exists to get right.
    const anchor = new Date('2026-09-22T18:00:00+03:00');
    const acts = [
      run('2026-09-21T07:00:00', 10), // this Monday
      run('2026-09-14T07:00:00', 10), // last Monday
      run('2026-09-16T07:00:00', 90), // last Wednesday — outside a 2-day window
    ];
    // Monday reader: 10 this week against 10 in the same two days last week.
    expect(computeLikeForLikeTrend(acts, anchor, MONDAY_WEEK)).toBe(0);
    // Sunday reader: same 10 so far, but last week's window is Sun–Tue, which for
    // a Sunday week means 09-13..09-15 — so only the 09-14 run counts. Still 0,
    // and the point is that it is computed off a DIFFERENT pair of windows.
    expect(computeLikeForLikeTrend(acts, anchor, SUNDAY_WEEK)).toBe(0);
  });

  it('defaults to Monday', () => {
    const anchor = new Date('2026-09-22T18:00:00+03:00');
    const acts = [run('2026-09-21T07:00:00', 20), run('2026-09-14T07:00:00', 10)];
    expect(computeLikeForLikeTrend(acts, anchor)).toBe(
      computeLikeForLikeTrend(acts, anchor, MONDAY_WEEK),
    );
  });
});

describe('the things that rank people', () => {
  it('never read the preference', () => {
    // The guard for Ofer's call: "the leaderboard will be hardcoded monday to
    // sunday". These two routes are the club-wide comparisons — the weekly
    // leaderboard and the pack war — and a `startDay` appearing in either is the
    // regression this file exists to catch.
    for (const route of ['app/api/groups/leaderboard/route.ts', 'app/api/groups/standings/route.ts']) {
      const src = read(route);
      expect(src, route).toMatch(/getActivityWeekStart\(/);
      expect(src, route).not.toMatch(/weekStartOn|readWeekStartDay|week_start_day/);
    }
  });

  it('keeps the streak on Monday even on a Sunday reader\'s own summary', () => {
    // A streak is printed on the profile AND in the streak leaderboard. One
    // number per athlete or the profile contradicts the table that ranks it.
    const src = read('app/api/athletes/summary/route.ts');
    expect(src).toMatch(/const mondayWeeks = new Set\(runs\.map\(\(r\) => activityWeekStart\(r\.start_time\)\)\)/);
    expect(src).toMatch(/computeWeekStreak\(mondayWeeks/);
  });

  it('leaves the coach\'s multi-athlete volume screen alone', () => {
    // fetchWeeklyVolume takes an optional startDay; /api/coach/volume draws a
    // column per member and must not pass one.
    const src = read('app/api/coach/volume/route.ts');
    expect(src).not.toMatch(/startDay|readWeekStartDay/);
  });
});

describe('the setting itself', () => {
  it('is offered on the profile and during sign-up', () => {
    expect(read('app/(app)/dashboard/profile/page.tsx')).toMatch(/<WeekStartSetting/);
    expect(read('app/join/onboard/page.tsx')).toMatch(/setWeekStartDay/);
  });

  it('says out loud that the leaderboard does not follow it', () => {
    // Without this note a member who switches and then sees a different km on the
    // leaderboard has found a bug rather than a preference.
    expect(read('components/profile/WeekStartSetting.tsx')).toMatch(/t\('weekStartNote'\)/);
    for (const f of ['../messages/he.json', '../messages/en.json']) {
      const m = JSON.parse(read(f));
      expect(m.profile.weekStartNote, f).toBeTruthy();
      expect(m.profile.weekMonSun, f).toBeTruthy();
      expect(m.profile.weekSunSat, f).toBeTruthy();
      expect(m.onboarding?.weekStartLabel || m.onboard?.weekStartLabel, f).toBeTruthy();
    }
  });

  it('rejects a day nobody asked for, rather than coercing it', () => {
    const src = read('app/api/athletes/me/route.ts');
    expect(src).toMatch(/weekStartDay must be 0 \(Sunday\) or 1 \(Monday\)/);
  });

  it('is defaulted to Monday by the migration', () => {
    // Every existing member keeps the week they are already looking at.
    const sql = readFileSync(join(SRC, '../supabase/migrations/119_athlete_week_start.sql'), 'utf8');
    expect(sql).toMatch(/week_start_day smallint NOT NULL DEFAULT 1/);
    expect(sql).toMatch(/CHECK \(week_start_day IN \(0, 1\)\)/);
  });
});
