import { describe, it, expect } from 'vitest';
import { fetchWeeklyVolume, weekAxis } from '@/lib/athletes/weekly-volume';

/**
 * The weekly-km series both volume charts draw.
 *
 * It replaced a read of `weekly_km_snapshots`, whose `week_start` anchor changed
 * from Monday to Sunday on 2026-08-21 while only the current and previous week are
 * ever recomputed — so 255 of 359 production rows are still Monday-keyed. Building
 * an axis from the distinct values present gave eight columns for six weeks, three
 * of them overlapping their neighbour by six days, and one athlete's steady
 * 175-185 km per week rendered as `179.3 72.3 52.2 177.8 0 182.7 174.5 93.3` — two
 * collapses and a rest week they never took, on the screen a coach uses to judge who
 * is overtrained.
 *
 * So what's pinned here is everything that has to stay true for a column to mean
 * one week: a generated axis of Mondays, week keys read off the date string rather
 * than an instant, and the paging — because the row cap is the one failure mode
 * that returns a plausible number instead of an error.
 *
 * Mondays, because on 2026-09-09 the activity week was re-split from the Sunday
 * plan week and put back on the watch's boundary — this chart is read next to a
 * Garmin app, so a column has to be the same seven days Garmin counted.
 */

type Row = {
  athlete_id: string;
  start_time: string;
  distance: number;
  duration: number;
  activity_type?: string | null;
};

const run = (athlete_id: string, start_time: string, km: number, over: Partial<Row> = {}): Row => ({
  athlete_id,
  start_time,
  distance: km * 1000,
  duration: Math.round(km * 300),
  activity_type: 'running',
  ...over,
});

/** Captures the `range()` windows asked for, and serves rows out of one array. */
function fakeSupabase(rows: Row[], opts: { ranges?: number[][] } = {}) {
  return {
    from: () => {
      const self: Record<string, any> = {};
      let from = 0;
      let to = rows.length - 1;
      for (const m of ['select', 'in', 'gte', 'order', 'returns']) self[m] = () => self;
      self.range = (a: number, b: number) => {
        from = a; to = b;
        opts.ranges?.push([a, b]);
        return self;
      };
      self.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows.slice(from, to + 1), error: null }).then(resolve);
      return self;
    },
  } as any;
}

const call = (rows: Row[], over: Partial<Parameters<typeof fetchWeeklyVolume>[1]> = {}, ranges?: number[][]) =>
  fetchWeeklyVolume(fakeSupabase(rows, { ranges }), {
    athleteIds: ['a1'],
    weeks: 4,
    currentWeekStart: '2026-09-07',
    ...over,
  });

describe('weekAxis', () => {
  it('is Mondays, oldest first, ending with the week we are standing in', () => {
    expect(weekAxis('2026-09-07', 4)).toEqual(['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']);
  });

  it('walks back across a month and a DST change without drifting off Monday', () => {
    // Built with local-date arithmetic, which is what keeps a clock change from
    // shifting a column: 7 calendar days, not 7 × 86400 s. Israel's clocks go
    // forward on 2026-03-27, inside this span.
    const axis = weekAxis('2026-04-06', 8);
    expect(axis).toHaveLength(8);
    for (const w of axis) expect(new Date(`${w}T12:00:00`).getDay()).toBe(1);
    expect(axis[0]).toBe('2026-02-16');
  });
});

describe('fetchWeeklyVolume', () => {
  it('sums each athlete\'s runs into the week they fall in', async () => {
    const { weeks, byAthlete } = await call([
      run('a1', '2026-09-07T06:00:00', 10),
      run('a1', '2026-09-08T06:00:00', 12),
      run('a1', '2026-08-31T06:00:00', 20),
    ]);

    expect(weeks).toEqual(['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']);
    expect(byAthlete.get('a1')!.map(b => b.meters / 1000)).toEqual([0, 0, 20, 22]);
    expect(byAthlete.get('a1')!.map(b => b.runs)).toEqual([0, 0, 1, 2]);
  });

  it('gives a week with no runs a zero column rather than dropping it', async () => {
    // The whole reason the axis is generated instead of collected: a missing column
    // shortens the chart silently, and a rest week is exactly what a coach is
    // looking for.
    const { byAthlete } = await call([run('a1', '2026-09-07T06:00:00', 10)]);
    const series = byAthlete.get('a1')!;
    expect(series).toHaveLength(4);
    expect(series.map(b => b.runs)).toEqual([0, 0, 0, 1]);
  });

  it('gives an athlete who has not run a full-length series of zeros', async () => {
    const { byAthlete } = await call([run('a1', '2026-09-07T06:00:00', 10)], { athleteIds: ['a1', 'a2'] });
    expect(byAthlete.get('a2')!.map(b => b.meters)).toEqual([0, 0, 0, 0]);
  });

  it('keeps a late Sunday run in the week it closes', async () => {
    // `start_time` is the athlete's wall clock stored as UTC. Read as an instant in
    // Israel (+3) a 21:30 Sunday becomes Monday 00:30 and jumps a column — which
    // moves distance out of the week the coach is grading. Sunday is the boundary
    // day now that activity weeks run Mon–Sun.
    const { byAthlete } = await call([run('a1', '2026-09-06T21:30:00', 15)]);
    expect(byAthlete.get('a1')!.map(b => b.meters / 1000)).toEqual([0, 0, 15, 0]);
  });

  it('counts only runs, and only ones with a distance and a time', async () => {
    const { byAthlete } = await call([
      run('a1', '2026-09-07T06:00:00', 10),
      run('a1', '2026-09-07T07:00:00', 40, { activity_type: 'cycling' }),
      run('a1', '2026-09-07T08:00:00', 5, { duration: 0 }),
      run('a1', '2026-09-07T09:00:00', 0),
      // Treadmill counts: it is a run the athlete actually did, and the club's
      // PR buckets already include it.
      run('a1', '2026-09-07T10:00:00', 8, { activity_type: 'treadmill_running' }),
    ]);
    expect(byAthlete.get('a1')![3]).toMatchObject({ meters: 18000, runs: 2 });
  });

  it('ignores a run from before the window and one from after it', async () => {
    const { byAthlete } = await call([
      run('a1', '2026-07-01T06:00:00', 30),
      run('a1', '2026-09-07T06:00:00', 10),
      run('a1', '2026-09-20T06:00:00', 25), // future-dated, past the axis
    ]);
    expect(byAthlete.get('a1')!.reduce((s, b) => s + b.meters, 0)).toBe(10000);
  });

  it('pages past the 1000-row cap instead of silently losing weeks', async () => {
    // Supabase truncates a select at 1000 rows and reports it as success, so an
    // outgrown query under-reports with no error to notice. Production is 2772
    // activities over 26 weeks for a 25-athlete roster, and even the 8-week default
    // is 807 — one more member and the chart would start shedding kilometres.
    const rows = Array.from({ length: 2350 }, (_, i) =>
      run('a1', '2026-09-07T06:00:00', 1, { duration: 300 + i }));
    const ranges: number[][] = [];
    const { byAthlete } = await call(rows, {}, ranges);

    expect(byAthlete.get('a1')![3].runs).toBe(2350);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('stops after one request when the first page is short', async () => {
    const ranges: number[][] = [];
    await call([run('a1', '2026-09-07T06:00:00', 10)], {}, ranges);
    expect(ranges).toEqual([[0, 999]]);
  });

  it('answers an empty roster without querying', async () => {
    const ranges: number[][] = [];
    const { weeks, byAthlete } = await call([], { athleteIds: [] }, ranges);
    expect(weeks).toHaveLength(4);
    expect(byAthlete.size).toBe(0);
    expect(ranges).toEqual([]);
  });
});
