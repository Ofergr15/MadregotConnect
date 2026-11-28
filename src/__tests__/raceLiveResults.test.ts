import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import {
  pickActivity, reconcile, orderResults, loadRaceResults, ACTIVITY_MIN_M, ACTIVITY_MAX_M,
  type ActivityCandidate, type RunnerResult,
} from '@/lib/race-live/results';

const cand = (o: Partial<ActivityCandidate>): ActivityCandidate =>
  ({ id: uid(), source: 'garmin', distanceM: 42_400, sec: 10_900, startTime: '2026-12-06T08:16:00', ...o });

describe('pickActivity', () => {
  it('keeps marathon-length runs only (warm-up and shake-out runs are not the race)', () => {
    expect(pickActivity([cand({ distanceM: 2_500 }), cand({ distanceM: ACTIVITY_MIN_M - 1 })])).toBeNull();
    expect(pickActivity([cand({ distanceM: ACTIVITY_MAX_M + 1 })])).toBeNull();
    expect(pickActivity([cand({ distanceM: ACTIVITY_MIN_M })])?.distanceM).toBe(ACTIVITY_MIN_M);
  });
  it('Garmin before Strava for the same run (the twin rule), then the longest', () => {
    const g = cand({ source: 'garmin', distanceM: 42_300 });
    const s = cand({ source: 'strava', distanceM: 42_600 });
    expect(pickActivity([s, g])).toBe(g);
    const g2 = cand({ source: 'garmin', distanceM: 42_700 });
    expect(pickActivity([g, s, g2])).toBe(g2);
  });
  it('a zero-time row is not a result', () => {
    expect(pickActivity([cand({ sec: 0 })])).toBeNull();
  });
});

describe('reconcile — Garmin wins', () => {
  const live = { sec: 10_800, source: 'manual' as const };
  it('a Garmin activity beats the live chip time, and the gap is reported', () => {
    expect(reconcile(live, cand({ source: 'garmin', sec: 10_830 }))).toEqual({ finishSec: 10_830, source: 'garmin', deltaToLiveSec: 30 });
  });
  it('a Strava activity beats the live time too', () => {
    expect(reconcile({ sec: 10_800, source: 'livetrack' }, cand({ source: 'strava', sec: 10_790 }))).toEqual({ finishSec: 10_790, source: 'strava', deltaToLiveSec: -10 });
  });
  it('no synced run yet: the live finish split', () => {
    expect(reconcile(live, null)).toEqual({ finishSec: 10_800, source: 'manual', deltaToLiveSec: 0 });
  });
  it('a synced run with no live finish (watch-only runner)', () => {
    expect(reconcile(null, cand({ sec: 12_000 }))).toEqual({ finishSec: 12_000, source: 'garmin', deltaToLiveSec: null });
  });
  it('nothing known → no time', () => {
    expect(reconcile(null, null)).toEqual({ finishSec: null, source: null, deltaToLiveSec: null });
  });
});

describe('orderResults', () => {
  const r = (name: string, finishSec: number | null, bib: string | null = null) => ({ name, finishSec, bib } as RunnerResult);
  it('finishers by time (ties by bib), then the rest by name', () => {
    const out = orderResults([r('Zed', null), r('B', 11_000, '20'), r('A', 10_000), r('C', 11_000, '10'), r('Amy', null)]);
    expect(out.map((x) => x.name)).toEqual(['A', 'C', 'B', 'Amy', 'Zed']);
  });
});

// ─── DB read + route ──────────────────────────────────────────────────────────

const EVENT = uid();
const [GARMIN, STRAVA, LIVE_ONLY, HIDDEN, NOTHING, FAN] = [uid(), uid(), uid(), uid(), uid(), uid()];

let db: ReturnType<typeof createMemoryDb>;
function seed(opts: { elapsedColumn?: boolean } = {}) {
  const actCols = ['id', 'athlete_id', 'start_time', 'distance', 'duration', 'garmin_activity_id', 'strava_activity_id', 'activity_type'];
  db = createMemoryDb({
    schema: {
      events: ['id', 'date'],
      race_entries: ['event_id', 'athlete_id', 'bib', 'goal_sec', 'live_opt_out'],
      race_splits: ['event_id', 'athlete_id', 'point', 'elapsed_sec', 'source'],
      athletes: ['id', 'name'],
      athlete_activities: opts.elapsedColumn === false ? actCols : [...actCols, 'elapsed_duration'],
    },
  });
  db.tables.events.push({ id: EVENT, date: '2026-12-06' });
  for (const [id, bib] of [[GARMIN, '101'], [STRAVA, '102'], [LIVE_ONLY, '103'], [NOTHING, '105']] as const) {
    db.tables.race_entries.push({ event_id: EVENT, athlete_id: id, bib, goal_sec: 10_800, live_opt_out: false });
  }
  db.tables.race_entries.push({ event_id: EVENT, athlete_id: HIDDEN, bib: '104', goal_sec: null, live_opt_out: true });
  db.tables.athletes.push(
    { id: GARMIN, name: 'Gal' }, { id: STRAVA, name: 'Shir' }, { id: LIVE_ONLY, name: 'Lior' }, { id: HIDDEN, name: 'Hila' }, { id: NOTHING, name: 'Noa' },
  );
  // Live splits: chip times for three; the hidden runner has one too.
  for (const [id, sec, source] of [[GARMIN, 10_800, 'manual'], [STRAVA, 11_500, 'livetrack'], [LIVE_ONLY, 12_100, 'manual'], [HIDDEN, 13_000, 'manual']] as const) {
    db.tables.race_splits.push({ event_id: EVENT, athlete_id: id, point: 'start', elapsed_sec: 0, source }, { event_id: EVENT, athlete_id: id, point: 'finish', elapsed_sec: sec, source });
  }
  db.tables.athlete_activities.push(
    // Gal: Garmin race (elapsed 3:00:42, moving 2:59:50), a Strava twin, and a warm-up.
    { id: uid(), athlete_id: GARMIN, start_time: '2026-12-06T08:16:00', distance: 42_350, duration: 10_790, elapsed_duration: 10_842, garmin_activity_id: 99, strava_activity_id: null, activity_type: 'running' },
    { id: uid(), athlete_id: GARMIN, start_time: '2026-12-06T08:16:05', distance: 42_380, duration: 10_795, elapsed_duration: 10_850, garmin_activity_id: null, strava_activity_id: '555', activity_type: 'running' },
    { id: uid(), athlete_id: GARMIN, start_time: '2026-12-06T07:40:00', distance: 2_000, duration: 700, elapsed_duration: 700, garmin_activity_id: 98, strava_activity_id: null, activity_type: 'running' },
    // Shir: Strava only.
    { id: uid(), athlete_id: STRAVA, start_time: '2026-12-06T08:20:00', distance: 42_500, duration: 11_400, elapsed_duration: 11_520, garmin_activity_id: null, strava_activity_id: '777', activity_type: 'running' },
    // Lior: a marathon-length run on ANOTHER day is not this race.
    { id: uid(), athlete_id: LIVE_ONLY, start_time: '2026-12-05T08:00:00', distance: 42_200, duration: 13_000, elapsed_duration: 13_000, garmin_activity_id: 97, strava_activity_id: null, activity_type: 'running' },
    // The hidden runner's activity must never surface.
    { id: uid(), athlete_id: HIDDEN, start_time: '2026-12-06T08:30:00', distance: 42_300, duration: 12_900, elapsed_duration: 12_950, garmin_activity_id: 96, strava_activity_id: null, activity_type: 'running' },
  );
}

describe('loadRaceResults', () => {
  beforeEach(() => seed());

  it('reconciles each runner (Garmin wins), orders finishers, leaves opted-out runners out', async () => {
    const { date, runners } = await loadRaceResults(db.client as any, EVENT, FAN);
    expect(date).toBe('2026-12-06');
    expect(runners.map((r) => r.name)).toEqual(['Gal', 'Shir', 'Lior', 'Noa']);
    const [gal, shir, lior, noa] = runners;
    expect(gal).toMatchObject({ finishSec: 10_842, source: 'garmin', deltaToLiveSec: 42, live: { sec: 10_800, source: 'manual' }, activity: { source: 'garmin', distanceM: 42_350 } });
    expect(shir).toMatchObject({ finishSec: 11_520, source: 'strava', deltaToLiveSec: 20 });
    expect(lior).toMatchObject({ finishSec: 12_100, source: 'manual', activity: null });
    expect(noa).toMatchObject({ finishSec: null, source: null, live: null, activity: null });
    expect(gal.splits.map((s) => s.point)).toEqual(['start', 'finish']);
    expect(runners.some((r) => r.athleteId === HIDDEN)).toBe(false);
  });

  it('an opted-out runner sees their own row', async () => {
    const { runners } = await loadRaceResults(db.client as any, EVENT, HIDDEN);
    expect(runners.find((r) => r.athleteId === HIDDEN)).toMatchObject({ finishSec: 12_950, source: 'garmin' });
  });

  it('migration 166 not applied: moving time is used instead of failing', async () => {
    seed({ elapsedColumn: false });
    const { runners } = await loadRaceResults(db.client as any, EVENT, FAN);
    expect(runners.find((r) => r.athleteId === GARMIN)).toMatchObject({ finishSec: 10_790, source: 'garmin' });
  });

  it('an event with no date: live times only', async () => {
    db.tables.events[0].date = null;
    const { runners } = await loadRaceResults(db.client as any, EVENT, FAN);
    expect(runners.find((r) => r.athleteId === GARMIN)).toMatchObject({ finishSec: 10_800, source: 'manual' });
  });
});

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
const flags = new Set<string>();
vi.mock('@/lib/features/server', () => ({ isFeatureEnabled: async (f: string, id: string | null) => flags.has(`${f}:${id}`) }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
const { GET } = await import('@/app/api/race-live/[eventId]/results/route');

describe('GET /api/race-live/[eventId]/results', () => {
  const ctx = { params: Promise.resolve({ eventId: EVENT }) };
  const as = (athleteId: string | null, extra: Record<string, unknown> = {}) =>
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId, isStaff: false, isSuperUser: false, role: 'runner', email: 'x', ...extra } });
  beforeEach(() => { seed(); flags.clear(); });

  it('signed out → the gate’s own denial', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response(null, { status: 401 }), caller: null });
    expect((await GET(new Request('http://x') as any, ctx)).status).toBe(401);
  });
  it('race_live off for the member → {enabled:false}, no data', async () => {
    as(FAN);
    expect(await (await GET(new Request('http://x') as any, ctx)).json()).toEqual({ enabled: false });
  });
  it('flag on → reconciled results', async () => {
    as(FAN);
    flags.add(`race_live:${FAN}`);
    const body = await (await GET(new Request('http://x') as any, ctx)).json();
    expect(body.enabled).toBe(true);
    expect(body.runners[0]).toMatchObject({ name: 'Gal', source: 'garmin' });
  });
  it('staff always', async () => {
    as(null, { isStaff: true });
    expect((await (await GET(new Request('http://x') as any, ctx)).json()).runners).toHaveLength(4);
  });
});
