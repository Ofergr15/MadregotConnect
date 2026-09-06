import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildKmTable,
  buildRecentRuns,
  buildAllTimeTotals,
  computeLikeForLikeTrend,
  pickWeek,
} from '@/lib/athletes/profile-stats';

// Shaping for the unified athlete profile's km table, runs list and stat trio.
// Every case below pins a mistake that is easy to make and hard to see once the
// numbers are on screen next to a real athlete's name.

// A run, given as the date it started on. Week boundaries are Sunday-based:
// 2026-08-30, 2026-08-23 and 2026-08-16 are all Sundays.
const run = (date: string, km: number, durationSec = km * 300) => ({
  id: `r-${date}-${km}`,
  activity_name: null,
  activity_type: 'running',
  start_time: `${date}T06:00:00`,
  distance: km * 1000,
  duration: durationSec,
});

describe('buildKmTable', () => {
  // The week keys these assertions expect are Sunday-anchored local dates, and
  // `start_time` is wall clock stored as UTC — so the clock is pinned to the
  // timezone every one of those rules was written for.
  const tz = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'Asia/Jerusalem'; });
  afterAll(() => { process.env.TZ = tz; });

  it('generates the window oldest-first ending on the current week', () => {
    const table = buildKmTable([], { limit: 4, currentWeekStart: '2026-08-30' });
    expect(table.map((r) => r.weekStart)).toEqual(['2026-08-09', '2026-08-16', '2026-08-23', '2026-08-30']);
  });

  it('always includes the current week, even with no runs in it at all', () => {
    // The headline number and the highlighted column both read off this table,
    // so a missing current week would leave the progress bar undefined.
    const table = buildKmTable([run('2026-08-17', 12)], { limit: 3, currentWeekStart: '2026-08-30' });
    expect(table[table.length - 1]).toMatchObject({ weekStart: '2026-08-30', km: 0, runs: 0, isCurrent: true });
  });

  it('buckets runs into their Sunday week and sums them', () => {
    const table = buildKmTable(
      [run('2026-08-30', 10), run('2026-09-01', 5.5), run('2026-08-26', 8)],
      { limit: 2, currentWeekStart: '2026-08-30' },
    );
    expect(table[0]).toMatchObject({ weekStart: '2026-08-23', km: 8, runs: 1 });
    expect(table[1]).toMatchObject({ weekStart: '2026-08-30', km: 15.5, runs: 2 });
  });

  it('ignores runs outside the window rather than folding them into an edge week', () => {
    // The naive version clamps out-of-range dates into the first bucket, which
    // makes the oldest column a dumping ground for the athlete's whole history.
    const table = buildKmTable(
      [run('2026-01-05', 200), run('2026-08-30', 10)],
      { limit: 2, currentWeekStart: '2026-08-30' },
    );
    expect(table.map((r) => r.km)).toEqual([0, 10]);
  });

  it('keeps a late Saturday-evening run in the week it closes', () => {
    // Read as an instant, a 21:30 Saturday run shifts +3h in Israel and jumps
    // into the next week, moving kilometres between two adjacent columns.
    // 2026-08-29 is the Saturday that CLOSES the 2026-08-23 week.
    const table = buildKmTable(
      [{ ...run('2026-08-29', 9), start_time: '2026-08-29T21:30:00' }],
      { limit: 2, currentWeekStart: '2026-08-30' },
    );
    expect(table[0]).toMatchObject({ weekStart: '2026-08-23', km: 9 });
    expect(table[1].km).toBe(0);
  });

  it('computes the week-over-week delta against the previous column', () => {
    const table = buildKmTable(
      [run('2026-08-24', 20), run('2026-08-31', 23)],
      { limit: 2, currentWeekStart: '2026-08-30' },
    );
    expect(table[1].deltaPct).toBe(15); // 20 → 23 km
  });

  it('gives the oldest column no delta', () => {
    // Even when older runs exist, the window's first column has nothing the
    // reader can see to compare against — a delta there would be measured off a
    // number that isn't on screen.
    const table = buildKmTable(
      [run('2026-08-17', 10), run('2026-08-24', 20)],
      { limit: 2, currentWeekStart: '2026-08-30' },
    );
    expect(table[0].weekStart).toBe('2026-08-23');
    expect(table[0].deltaPct).toBeNull();
  });

  it('reports no delta when the previous week was a zero week', () => {
    // 0 km can't be a denominator. Both "+∞%" and a bare "+100%" for 0 → 14 km
    // would be wrong, and a rest week is a normal thing to have.
    const table = buildKmTable([run('2026-08-31', 14)], { limit: 2, currentWeekStart: '2026-08-30' });
    expect(table[1].deltaPct).toBeNull();
  });

  it('reports a negative delta for a down week', () => {
    const table = buildKmTable(
      [run('2026-08-24', 40), run('2026-08-31', 30)],
      { limit: 2, currentWeekStart: '2026-08-30' },
    );
    expect(table[1].deltaPct).toBe(-25);
  });

  it('derives pace from the week total, and leaves a zero week without one', () => {
    // 20 km in 6000 s = 300 s/km = 5:00/km.
    const table = buildKmTable([run('2026-08-24', 20, 6000)], { limit: 2, currentWeekStart: '2026-08-30' });
    expect(table[0].paceSecPerKm).toBe(300);
    expect(table[1].paceSecPerKm).toBeNull();
  });

  it('drops a zero-duration row instead of dividing by it', () => {
    // Strava-imported rows have arrived with a duration of 0; a pace derived
    // from one is Infinity and renders as a blank-looking "NaN:aN". The shared
    // qualifying filter already excludes them, so the week reads as empty rather
    // than as 12 km at an impossible pace — and this pins that it stays that way.
    const table = buildKmTable([run('2026-08-31', 12, 0)], { limit: 1, currentWeekStart: '2026-08-30' });
    expect(table[0]).toMatchObject({ km: 0, runs: 0, paceSecPerKm: null });
  });

  it('marks exactly one column current', () => {
    const table = buildKmTable([], { limit: 4, currentWeekStart: '2026-08-30' });
    expect(table.filter((r) => r.isCurrent).map((r) => r.weekStart)).toEqual(['2026-08-30']);
  });

  it('counts only runs, not rides and not zero-distance rows', () => {
    const table = buildKmTable(
      [
        { ...run('2026-08-31', 40), activity_type: 'cycling' },
        { ...run('2026-08-31', 0), distance: 0 },
        run('2026-08-31', 6),
      ],
      { limit: 1, currentWeekStart: '2026-08-30' },
    );
    expect(table[0]).toMatchObject({ km: 6, runs: 1 });
  });

  it('returns a full window of zeroes for an athlete with no runs', () => {
    // Ten honest zeroes, not an empty array: the chart's own emptiness check is
    // "did they run at all", which it can only make if the weeks are there.
    const table = buildKmTable([], { limit: 10, currentWeekStart: '2026-08-30' });
    expect(table).toHaveLength(10);
    expect(table.every((r) => r.km === 0 && r.runs === 0 && r.deltaPct === null)).toBe(true);
  });
});

describe('buildRecentRuns', () => {
  const act = (over: Partial<Parameters<typeof buildRecentRuns>[0][number]> = {}) => ({
    id: 'a1',
    activity_name: 'ריצת בוקר',
    activity_type: 'running',
    start_time: '2026-08-30T05:00:00',
    distance: 10000,
    duration: 3000,
    ...over,
  });

  it('shapes a run into km, duration and pace', () => {
    const [r] = buildRecentRuns([act()]);
    expect(r.km).toBe(10);
    expect(r.paceSecPerKm).toBe(300);
    expect(r.name).toBe('ריצת בוקר');
  });

  it('sorts newest first', () => {
    const runs = buildRecentRuns([
      act({ id: 'old', start_time: '2026-08-01T05:00:00' }),
      act({ id: 'new', start_time: '2026-08-30T05:00:00' }),
    ]);
    expect(runs.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('excludes non-runs and zero-distance rows', () => {
    // Uses the same filter as the PR view and the badge engine, so a run that
    // shows in this list is a run that could have earned a badge.
    const runs = buildRecentRuns([
      act({ id: 'ride', activity_type: 'cycling' }),
      act({ id: 'empty', distance: 0 }),
      act({ id: 'walk', activity_type: 'walking' }),
      act({ id: 'real' }),
    ]);
    expect(runs.map((r) => r.id)).toEqual(['real']);
  });

  it('honours the limit', () => {
    const many = Array.from({ length: 8 }, (_, i) => act({ id: `a${i}`, start_time: `2026-08-0${i + 1}T05:00:00` }));
    expect(buildRecentRuns(many, 3)).toHaveLength(3);
  });

  it('keeps a run whose activity_type is null', () => {
    // Older synced rows have no type; treating a missing type as "not a run"
    // would silently empty the list for anyone who joined before the sync
    // started recording it.
    expect(buildRecentRuns([act({ id: 'legacy', activity_type: null })])).toHaveLength(1);
  });
});

describe('buildAllTimeTotals', () => {
  it('sums distance to whole km, hours to one decimal', () => {
    const totals = buildAllTimeTotals([
      { start_time: '2026-08-01T05:00:00', distance: 10400, duration: 3600 },
      { start_time: '2026-08-02T05:00:00', distance: 5200, duration: 1800 },
    ]);
    expect(totals.totalKm).toBe(16); // 15.6 → 16
    expect(totals.totalRuns).toBe(2);
    expect(totals.totalHours).toBe(1.5);
  });

  it('counts only qualifying runs', () => {
    const totals = buildAllTimeTotals([
      { start_time: '2026-08-01T05:00:00', activity_type: 'cycling', distance: 40000, duration: 3600 },
      { start_time: '2026-08-02T05:00:00', activity_type: 'running', distance: 5000, duration: 1500 },
    ]);
    expect(totals.totalKm).toBe(5);
    expect(totals.totalRuns).toBe(1);
  });

  it('returns zeros for no history rather than NaN', () => {
    expect(buildAllTimeTotals([])).toEqual({ totalKm: 0, totalRuns: 0, totalHours: 0 });
  });
});

describe('pickWeek', () => {
  const tz = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'Asia/Jerusalem'; });
  afterAll(() => { process.env.TZ = tz; });

  it('reads the requested week off the table', () => {
    const table = buildKmTable(
      [run('2026-08-24', 20), run('2026-08-31', 10), run('2026-09-02', 15)],
      { limit: 2, currentWeekStart: '2026-08-30' },
    );
    expect(pickWeek(table, '2026-08-30')).toEqual({ km: 25, runs: 2 });
  });

  it('returns an explicit zero week when the week is missing', () => {
    // The progress bar must render at 0 rather than be left undefined — a
    // brand-new athlete has no snapshot row at all in their first week.
    expect(pickWeek([], '2026-08-30')).toEqual({ km: 0, runs: 0 });
  });
});

describe('computeLikeForLikeTrend', () => {
  // These assertions depend on which weekday a date falls on, and on the
  // wall-clock-stored-as-UTC convention of `start_time` — so the clock is pinned
  // to Israel, the timezone every one of those rules was written for.
  const tz = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'Asia/Jerusalem'; });
  afterAll(() => { process.env.TZ = tz; });

  // 2026-08-30 is a Sunday, so 2026-09-02 is the Wednesday of that week
  // (daysElapsed = 4) and the comparable slice of the previous week is
  // 2026-08-23 (Sun) through 2026-08-26 exclusive.
  const wed = new Date('2026-09-02T09:00:00');
  const run = (start: string, km: number) => ({ start_time: start, distance: km * 1000, duration: km * 300 });

  it('compares this week so far against the same slice of last week', () => {
    // 12 km by Wednesday against 10 km by the same point last week.
    const trend = computeLikeForLikeTrend(
      [run('2026-08-31T06:00:00', 12), run('2026-08-24T06:00:00', 10)],
      wed,
    );
    expect(trend).toBe(20);
  });

  it('ignores the part of last week that had not happened yet by this weekday', () => {
    // The Friday run is real, and counting it would compare 12 km of a
    // three-day-old week against a full seven-day one — the "−80% every Monday"
    // bug this function exists to avoid.
    const trend = computeLikeForLikeTrend(
      [run('2026-08-31T06:00:00', 12), run('2026-08-24T06:00:00', 10), run('2026-08-28T06:00:00', 30)],
      wed,
    );
    expect(trend).toBe(20);
  });

  it('returns null when the comparable slice of last week had no runs', () => {
    // No percentage exists against zero, and "+∞%" is not a badge.
    expect(computeLikeForLikeTrend([run('2026-08-31T06:00:00', 12)], wed)).toBeNull();
  });

  it('returns null with no history at all', () => {
    expect(computeLikeForLikeTrend([], wed)).toBeNull();
  });

  it('reports a negative trend when this week is behind', () => {
    const trend = computeLikeForLikeTrend(
      [run('2026-08-31T06:00:00', 5), run('2026-08-24T06:00:00', 10)],
      wed,
    );
    expect(trend).toBe(-50);
  });

  it('keeps a late Saturday-evening run in its own week', () => {
    // The whole reason `activityWeekStart` is used rather than local date
    // getters: read as an instant, a 21:30 Saturday run shifts +3h and jumps
    // into the next week, moving kilometres between the two sides of this ratio.
    // 2026-08-29 is the Saturday that CLOSES the 2026-08-23 week.
    const trend = computeLikeForLikeTrend(
      [run('2026-08-31T06:00:00', 10), run('2026-08-24T06:00:00', 10), run('2026-08-29T21:30:00', 8)],
      wed,
    );
    // The Saturday run is last week's, and it is past the Wednesday cutoff, so
    // it counts to neither side — the ratio stays 10 v 10.
    expect(trend).toBe(0);
  });
});
