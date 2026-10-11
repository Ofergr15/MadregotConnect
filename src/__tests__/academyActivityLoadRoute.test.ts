import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/** GET /api/academy/activity-load — the ⚡ sheet of one run (mockup 5ב). */

const TRAINEE = uid();
const COACH = uid();
const STRANGER = uid();

const requireCallerForAthlete = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  requireCallerForAthlete: (r: Request, id: string) => requireCallerForAthlete(r, id),
}));
vi.mock('@/lib/academy/pairing-server', () => ({
  mayCoach: async (c: { athleteId: string }, id: string) => c.athleteId === id || (c.athleteId === COACH && id === TRAINEE),
}));

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const { GET } = await import('@/app/api/academy/activity-load/route');
const get = (q: string) => GET(new Request(`http://x/api/academy/activity-load?${q}`));

const SCHEMA: Record<string, string[]> = {
  athlete_activities: ['id', 'athlete_id', 'start_time', 'activity_type', 'distance', 'duration', 'moving_duration', 'average_hr', 'max_hr', 'laps', 'splits', 'source'],
  academy_tests: ['id', 'athlete_id', 'test_date', 'protocol', 'duration_sec', 'distance_m', 'excluded_reason', 'status'],
  athlete_wellness: ['athlete_id', 'date', 'resting_hr', 'sleep_seconds'],
};
const LOADS = ['activity_id', 'athlete_id', 'activity_date', 'load', 'source', 'threshold_sec', 'basis_test_date', 'formula_version', 'computed_at'];

const RUN = uid();
const OTHERS = uid();
const lap = (distance: number, duration: number) => ({ distance, duration });
const LAPS = [
  lap(1000, 340), lap(1000, 340),
  lap(1000, 244), lap(333, 120), lap(1000, 243), lap(333, 120), lap(1000, 242), lap(333, 120), lap(1000, 241), lap(333, 120), lap(1000, 236),
  lap(1000, 330), lap(1000, 330),
];

function seed(withTable: boolean) {
  db = createMemoryDb({ schema: withTable ? { ...SCHEMA, activity_loads: LOADS } : SCHEMA });
  db.tables.academy_tests.push(
    { id: uid(), athlete_id: TRAINEE, test_date: '2026-09-16', protocol: '30min', duration_sec: 1800, distance_m: 7143, excluded_reason: null, status: 'approved' },
    // A later test must not price an earlier run.
    { id: uid(), athlete_id: TRAINEE, test_date: '2026-10-20', protocol: '30min', duration_sec: 1800, distance_m: 7500, excluded_reason: null, status: 'approved' },
  );
  db.tables.athlete_activities.push(
    { id: RUN, athlete_id: TRAINEE, start_time: '2026-10-13T06:30:00', activity_type: 'running', distance: 10332, duration: 3122, moving_duration: 3100, average_hr: 150, max_hr: 172, laps: LAPS, splits: null },
    { id: OTHERS, athlete_id: STRANGER, start_time: '2026-10-13T06:30:00', activity_type: 'running', distance: 5000, duration: 1500, moving_duration: 1500, average_hr: 150, max_hr: 172, laps: null, splits: null },
  );
}

const as = (athleteId: string, extra: Record<string, unknown> = {}) =>
  requireCallerForAthlete.mockResolvedValue({ denied: null, caller: { athleteId, isStaff: athleteId !== TRAINEE, isSuperUser: false, role: 'runner', ...extra } });

beforeEach(() => {
  seed(true);
  as(TRAINEE);
});

describe('the request', () => {
  it('needs both ids', async () => {
    expect((await get(`athleteId=${TRAINEE}`)).status).toBe(400);
  });

  it('is 403 for a stranger', async () => {
    as(STRANGER);
    expect((await get(`athleteId=${TRAINEE}&activityId=${RUN}`)).status).toBe(403);
    expect(db.log).toHaveLength(0);
  });

  it('is 404 for an activity that is not the athlete\'s own', async () => {
    expect((await get(`athleteId=${TRAINEE}&activityId=${OTHERS}`)).status).toBe(404);
  });
});

describe('the sheet', () => {
  it('is mockup 5ב: 64 = 10 + 37 + 6 + 11, on the test valid that day', async () => {
    const res = await get(`athleteId=${TRAINEE}&activityId=${RUN}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ load: 64, source: 'pace', thresholdSec: 252, basisTestDate: '2026-09-16' });
    expect(body.parts.map((p: { load: number }) => p.load)).toEqual([10, 37, 6, 11]);
    expect(body.parts[1]).toMatchObject({ labelKey: 'trainee.loadSheet.part.work', params: { count: 5, distM: 1000, paceSec: 241 } });
  });

  it('is 200 for the coach, and stores the row', async () => {
    as(COACH);
    expect((await get(`athleteId=${TRAINEE}&activityId=${RUN}`)).status).toBe(200);
    expect(db.tables.activity_loads).toEqual([expect.objectContaining({ activity_id: RUN, athlete_id: TRAINEE, activity_date: '2026-10-13', load: 64, source: 'pace' })]);
  });

  it('under view-as stores nothing', async () => {
    as(TRAINEE, { viewingAsBy: 'admin@club' });
    expect((await get(`athleteId=${TRAINEE}&activityId=${RUN}`)).status).toBe(200);
    expect(db.log.some(l => l.op === 'upsert')).toBe(false);
  });

  it('without migration 142 still answers, and writes nothing', async () => {
    seed(false);
    const body = await (await get(`athleteId=${TRAINEE}&activityId=${RUN}`)).json();
    expect(body.load).toBe(64);
    expect(db.log.some(l => l.op !== 'select')).toBe(false);
  });
});
