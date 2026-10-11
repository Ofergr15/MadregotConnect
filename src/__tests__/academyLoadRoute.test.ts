import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/**
 * GET /api/academy/load — fitness, fatigue, form for one trainee.
 *
 * What only the route can get wrong: WHO may read it (the trainee, their coach, the
 * manager — `mayCoach`), that it still answers with numbers before migration 142 is
 * pasted (and writes nothing then), and that view-as never stores a load.
 */

const TRAINEE = uid();
const COACH = uid();
const STRANGER = uid();

const requireCallerForAthlete = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  requireCallerForAthlete: (r: Request, id: string) => requireCallerForAthlete(r, id),
}));
vi.mock('@/lib/academy/pairing-server', () => ({
  // The 1:1 line: self, or this trainee's coach.
  mayCoach: async (c: { athleteId: string }, id: string) => c.athleteId === id || (c.athleteId === COACH && id === TRAINEE),
}));

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const { GET } = await import('@/app/api/academy/load/route');
const get = (q: string) => GET(new Request(`http://x/api/academy/load?${q}`));

const SCHEMA: Record<string, string[]> = {
  athlete_activities: ['id', 'athlete_id', 'start_time', 'activity_type', 'distance', 'duration', 'moving_duration', 'average_hr', 'max_hr', 'laps', 'splits', 'source'],
  academy_tests: ['id', 'athlete_id', 'test_date', 'protocol', 'duration_sec', 'distance_m', 'excluded_reason', 'status'],
  athlete_wellness: ['athlete_id', 'date', 'resting_hr', 'sleep_seconds'],
  athletes: ['id', 'group_id', 'name'],
  groups: ['id', 'name'],
  weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'parsed_workouts', 'status', 'created_at'],
  academy_candidates: ['id', 'athlete_id'],
  academy_characterizations: ['candidate_id', 'target_race_date'],
};
const LOADS = ['activity_id', 'athlete_id', 'activity_date', 'load', 'source', 'threshold_sec', 'basis_test_date', 'formula_version', 'computed_at'];

const israelDay = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

function seed(withTable: boolean) {
  db = createMemoryDb({ schema: withTable ? { ...SCHEMA, activity_loads: LOADS } : SCHEMA });
  db.tables.athletes.push({ id: TRAINEE, group_id: null, name: 'Shahar' });
  db.tables.academy_tests.push({ id: uid(), athlete_id: TRAINEE, test_date: israelDay(-200), protocol: '30min', duration_sec: 1800, distance_m: 7143, excluded_reason: null, status: 'approved' });
  // 60 days, a run every other day.
  for (let i = 60; i >= 1; i -= 2) {
    db.tables.athlete_activities.push({
      id: uid(), athlete_id: TRAINEE, start_time: `${israelDay(-i)}T07:00:00`, activity_type: 'running',
      distance: 10000, duration: 3300, moving_duration: 3300, average_hr: 150, max_hr: 178, laps: null,
      splits: Array.from({ length: 10 }, () => ({ distance: 1000, duration: 330 })),
    });
  }
}

const as = (athleteId: string, extra: Record<string, unknown> = {}) =>
  requireCallerForAthlete.mockResolvedValue({ denied: null, caller: { athleteId, isStaff: athleteId !== TRAINEE, isSuperUser: false, role: 'runner', ...extra } });

beforeEach(() => {
  seed(true);
  as(TRAINEE);
});

describe('the request', () => {
  it('needs an athlete and a known range', async () => {
    expect((await get('range=6w')).status).toBe(400);
    expect((await get(`athleteId=${TRAINEE}&range=1y`)).status).toBe(400);
  });

  it('is 403 for a stranger, and reads nothing', async () => {
    as(STRANGER);
    expect((await get(`athleteId=${TRAINEE}`)).status).toBe(403);
    expect(db.log).toHaveLength(0);
  });

  it('passes the auth denial straight through', async () => {
    requireCallerForAthlete.mockResolvedValue({ denied: new Response('{}', { status: 401 }), caller: {} });
    expect((await get(`athleteId=${TRAINEE}`)).status).toBe(401);
  });
});

describe('the answer', () => {
  it('is 200 for the trainee, with the shape the screens draw, and stores the loads', async () => {
    const res = await get(`athleteId=${TRAINEE}&range=6w`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: { kind: 'ok' }, range: '6w', thresholdSec: 252, stored: true });
    expect(body.today).toEqual({
      fitness: expect.any(Number), fatigue: expect.any(Number), form: expect.any(Number), ramp: expect.any(Number),
      band: expect.any(String), rampWord: expect.any(String),
    });
    expect(body.series.length).toBeGreaterThan(30);
    expect(body.weekly.length).toBeGreaterThan(0);
    expect(db.tables.activity_loads).toHaveLength(30);
  });

  it('is 200 for the trainee\'s coach', async () => {
    as(COACH);
    expect((await get(`athleteId=${TRAINEE}`)).status).toBe(200);
  });

  it('without migration 142 still answers with numbers, and writes nothing', async () => {
    seed(false);
    const res = await get(`athleteId=${TRAINEE}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stored).toBe(false);
    expect(body.series.length).toBeGreaterThan(30);
    expect(body.weekly.some((w: { done: number }) => w.done > 0)).toBe(true);
    expect(db.log.some(l => l.op !== 'select')).toBe(false);
  });

  it('under view-as prices in memory and upserts nothing', async () => {
    as(TRAINEE, { viewingAsBy: 'admin@club' });
    const res = await get(`athleteId=${TRAINEE}`);
    expect(res.status).toBe(200);
    expect((await res.json()).series.length).toBeGreaterThan(30);
    expect(db.log.some(l => l.op === 'upsert')).toBe(false);
    expect(db.tables.activity_loads).toHaveLength(0);
  });
});
