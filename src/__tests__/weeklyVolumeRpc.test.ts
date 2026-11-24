import { beforeEach, describe, expect, it } from 'vitest';
import { fetchWeeklyVolume, resetVolumeRpcProbe } from '@/lib/athletes/weekly-volume';
import { PR_RUN_TYPES } from '@/lib/prs/pr-buckets';

/**
 * S7: fetchWeeklyVolume asks the database to bucket (migration 206,
 * weekly_volume_buckets) and falls back to the paged read when it can't. The two
 * paths must produce the same series for the same rows — the fake RPC below is an
 * independent model of the SQL (UTC wall-clock date, DOW arithmetic, the same
 * qualifying filter), not a call back into the JS bucketing.
 */

type Row = { id: number; athlete_id: string; start_time: string; distance: number; duration: number; activity_type: string | null; elevation_gain: number | null };

let n = 0;
const r = (athlete_id: string, start_time: string, distance: number, over: Partial<Row> = {}): Row =>
  ({ id: ++n, athlete_id, start_time, distance, duration: Math.round(distance * 0.3), activity_type: 'running', elevation_gain: 12, ...over });

/** What Postgres would compute for `weekly_volume_buckets`. */
function sqlBuckets(rows: Row[], p: { p_athlete_ids: string[]; p_since: string; p_start_day: number; p_run_types: string[] }) {
  const since = Date.parse(`${p.p_since}T00:00:00Z`);
  const out = new Map<string, any>();
  for (const a of rows) {
    // timestamptz from PostgREST carries +00:00; AT TIME ZONE 'UTC' → wall clock.
    const t = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(a.start_time) ? a.start_time : `${a.start_time}Z`);
    if (!p.p_athlete_ids.includes(a.athlete_id) || t.getTime() < since) continue;
    if (!(a.distance > 0 && a.duration > 0)) continue;
    if (!(a.activity_type == null || a.activity_type === '' || p.p_run_types.includes(a.activity_type))) continue;
    const day = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() - p.p_start_day + 7) % 7));
    const week = day.toISOString().slice(0, 10);
    const k = `${a.athlete_id}|${week}`;
    const g = out.get(k) ?? { athlete_id: a.athlete_id, week_start: week, meters: 0, runs: 0, seconds: 0, climb_m: 0 };
    g.meters += a.distance; g.runs += 1; g.seconds += a.duration; g.climb_m += a.elevation_gain ?? 0;
    out.set(k, g);
  }
  // Postgres sends numeric/bigint as JSON numbers or strings depending on size; use strings.
  return [...out.values()]
    .sort((x, y) => (x.athlete_id + x.week_start).localeCompare(y.athlete_id + y.week_start))
    .map((g) => ({ ...g, meters: String(g.meters), runs: String(g.runs), seconds: String(g.seconds), climb_m: String(g.climb_m) }));
}

function fake(rows: Row[], rpc: 'ok' | 'missing' | 'error' | 'none', log: { rpc: number; select: number; args?: unknown; orders: string[] }) {
  const page = (all: unknown[]) => {
    const q: any = {}; let from = 0; let to = all.length - 1;
    for (const m of ['select', 'in', 'gte', 'returns']) q[m] = () => q;
    q.order = (c: string) => { log.orders.push(c); return q; };
    q.range = (a: number, b: number) => { from = a; to = b; return q; };
    q.then = (ok: any, ko: any) => Promise.resolve({ data: all.slice(from, to + 1), error: null }).then(ok, ko);
    return q;
  };
  const db: any = {
    from: () => { log.select++; return page([...rows].sort((a, b) => a.id - b.id)); },
  };
  if (rpc !== 'none') {
    db.rpc = (name: string, args: any) => {
      log.rpc++; log.args = { name, ...args };
      if (rpc === 'ok') return page(sqlBuckets(rows, args));
      const q: any = {};
      for (const m of ['order', 'range', 'returns']) q[m] = () => q;
      const error = rpc === 'missing' ? { code: 'PGRST202', message: 'not found' } : { code: '57014', message: 'timeout' };
      q.then = (ok: any, ko: any) => Promise.resolve({ data: null, error }).then(ok, ko);
      return q;
    };
  }
  return db;
}

const opts = { athleteIds: ['a1', 'a2'], weeks: 4, currentWeekStart: '2026-09-07' };
const rows = [
  r('a1', '2026-08-17T06:00:00+00:00', 10000.25),          // Mon, first axis column
  r('a1', '2026-08-23T21:30:00+00:00', 5000),              // Sun 21:30 wall clock — still Mon 08-17's week
  r('a1', '2026-08-24T00:10:00+00:00', 8000, { elevation_gain: null }),
  r('a1', '2026-08-30T12:00:00', 12000, { activity_type: null }),  // bare string, null type counts
  r('a1', '2026-08-31T06:00:00+00:00', 7000, { activity_type: 'cycling' }), // not a run
  r('a1', '2026-09-01T06:00:00+00:00', 0),                 // zero distance
  r('a1', '2026-09-08T06:00:00+00:00', 6000, { activity_type: '' }),
  r('a1', '2026-09-20T06:00:00+00:00', 25000),             // past the axis
  r('a2', '2026-09-06T23:59:00+00:00', 21100, { activity_type: 'trail_running' }),
  r('a2', '2026-08-10T06:00:00+00:00', 30000),             // before the axis
  r('zz', '2026-09-07T06:00:00+00:00', 9999),              // not asked for
];

const mkLog = () => ({ rpc: 0, select: 0, orders: [] as string[], args: undefined as unknown });

beforeEach(() => resetVolumeRpcProbe());

describe('fetchWeeklyVolume via weekly_volume_buckets', () => {
  for (const startDay of [1, 0] as const) {
    it(`same series as the paged read for the same rows (startDay ${startDay})`, async () => {
      // A Sunday-week caller passes a Sunday currentWeekStart (one athlete's own preference).
      const o = { ...opts, startDay, currentWeekStart: startDay === 1 ? '2026-09-07' : '2026-09-06' };
      const viaRpc = await fetchWeeklyVolume(fake(rows, 'ok', mkLog()), o);
      const viaRows = await fetchWeeklyVolume(fake(rows, 'none', mkLog()), o);
      expect(viaRpc.weeks).toEqual(viaRows.weeks);
      expect([...viaRpc.byAthlete.entries()]).toEqual([...viaRows.byAthlete.entries()]);
      // and it isn't trivially equal: there is data in it
      expect(viaRows.byAthlete.get('a1')!.some((b) => b.runs > 0)).toBe(true);
    });
  }

  it('one round trip, no activity rows, with the run types and anchor passed through', async () => {
    const log = mkLog();
    const { byAthlete } = await fetchWeeklyVolume(fake(rows, 'ok', log), opts);
    expect(log).toMatchObject({ rpc: 1, select: 0 });
    expect(log.args).toMatchObject({ name: 'weekly_volume_buckets', p_athlete_ids: ['a1', 'a2'], p_since: '2026-08-17', p_start_day: 1, p_run_types: [...PR_RUN_TYPES] });
    expect(log.orders).toEqual(['athlete_id', 'week_start']); // a total order for paging
    expect(byAthlete.get('a1')![0]).toEqual({ weekStart: '2026-08-17', meters: 15000.25, runs: 2, seconds: 4500, climbM: 24 });
  });

  it('a generated axis: an empty week is a zero column, an athlete with nothing is all zeros', async () => {
    const { weeks, byAthlete } = await fetchWeeklyVolume(fake(rows, 'ok', mkLog()), { ...opts, athleteIds: ['a1', 'nobody'] });
    expect(weeks).toEqual(['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']);
    expect(byAthlete.get('nobody')!.map((b) => b.runs)).toEqual([0, 0, 0, 0]);
  });

  it('falls back to the paged read on any RPC error, and stops probing once it is known missing', async () => {
    const reference = await fetchWeeklyVolume(fake(rows, 'none', mkLog()), opts);

    const err = mkLog();
    expect([...(await fetchWeeklyVolume(fake(rows, 'error', err), opts)).byAthlete]).toEqual([...reference.byAthlete]);
    expect(err).toMatchObject({ rpc: 1, select: 1 });

    const first = mkLog();
    expect([...(await fetchWeeklyVolume(fake(rows, 'missing', first), opts)).byAthlete]).toEqual([...reference.byAthlete]);
    expect(first).toMatchObject({ rpc: 1, select: 1 });
    const second = mkLog();
    await fetchWeeklyVolume(fake(rows, 'missing', second), opts);
    expect(second).toMatchObject({ rpc: 0, select: 1 });
  });

  it('pages the RPC too when athletes × weeks passes the 1000-row cap', async () => {
    const many = Array.from({ length: 30 }, (_, a) =>
      Array.from({ length: 52 }, (_, w) => {
        const d = new Date(Date.UTC(2025, 8, 8 + 7 * w, 6));
        return r(`b${a}`, d.toISOString().replace('Z', '+00:00'), 5000);
      })).flat();
    const ids = Array.from({ length: 30 }, (_, a) => `b${a}`);
    const o = { athleteIds: ids, weeks: 52, currentWeekStart: '2026-08-31' };
    const viaRpc = await fetchWeeklyVolume(fake(many, 'ok', mkLog()), o);
    const viaRows = await fetchWeeklyVolume(fake(many, 'none', mkLog()), o);
    expect([...viaRpc.byAthlete]).toEqual([...viaRows.byAthlete]);
    expect([...viaRpc.byAthlete.values()].flat().reduce((s, b) => s + b.runs, 0)).toBe(1560);
  });
});
