import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';

/**
 * GET /api/academy/today — the academy trainee's home (trainee-experience-v2, 1/1ב/1ג).
 *
 * What only the route can get wrong: WHO may read it, WHOSE plan row it reads (the
 * trainee's own, else the club's — never another trainee's personal week, which sits in
 * the same table under the same coach_id), and turning the rows into the day: a workout,
 * a rest day with tomorrow under it, no plan at all, a new trainee still being learned.
 */

// Tuesday 13 October 2026, 06:42 in Israel — mockup 1's clock. Only Date is faked.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-13T06:42:00+03:00'));
afterAll(() => { vi.useRealTimers(); });

const TODAY = '2026-10-13';
const WEEK = '2026-10-11';
const day = (offset: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const TRAINEE = uid();
const OTHER = uid();
const COACH = uid();
const STRANGER = uid();
const GROUP = uid();

const requireCallerForAthlete = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  requireCallerForAthlete: (r: Request, id: string) => requireCallerForAthlete(r, id),
}));
vi.mock('@/lib/academy/pairing-server', () => ({
  mayCoach: async (c: { athleteId: string }, id: string) => c.athleteId === id || (c.athleteId === COACH && id === TRAINEE),
  isAcademyManager: () => false,
}));
vi.mock('@/lib/stream/server', () => ({ getStreamServerClient: () => { throw new Error('no Stream in tests'); } }));

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const { GET } = await import('@/app/api/academy/today/route');
const get = (q: string) => GET(new Request(`http://x/api/academy/today?${q}`));

const SCHEMA: Record<string, string[]> = {
  athletes: ['id', 'coach_id', 'name', 'gender', 'group_id', 'is_academy', 'academy_coach_id', 'academy_band_id', 'avatar_url'],
  groups: ['id', 'name', 'coach_id'],
  weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'parsed_workouts', 'status', 'created_at'],
  workout_deliveries: ['athlete_id', 'workout_date', 'status'],
  athlete_wellness: ['athlete_id', 'date', 'sleep_seconds', 'resting_hr'],
  athlete_activities: ['id', 'athlete_id', 'start_time', 'activity_type', 'distance', 'duration', 'moving_duration', 'average_hr', 'max_hr', 'laps', 'splits'],
  academy_tests: ['id', 'athlete_id', 'test_date', 'protocol', 'duration_sec', 'distance_m', 'excluded_reason', 'status'],
  academy_test_invitations: ['id', 'athlete_id', 'protocol', 'proposed_slots', 'confirmed_slot', 'status', 'created_at'],
  academy_candidates: ['id', 'athlete_id'],
  academy_characterizations: ['candidate_id', 'goal_type', 'target_race', 'target_race_date'],
  academy_bands: ['id', 'band_number', 'name', 'goal', 'pace_profile'],
};

const pace = (sec: number) => ({ targetType: 'pace', targetPaceMinPerKm: sec, targetPaceMaxPerKm: sec });
const run = (order: number, type: string, metres: number, sec: number) => ({ order, type, durationType: 'distance', durationValue: metres, ...pace(sec) });
const reps = (order: number, count: number, metres: number, sec: number) => ({
  order, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: count,
  repeatSteps: [
    { order: 1, type: 'interval', durationType: 'distance', durationValue: metres, ...pace(sec) },
    { order: 2, type: 'recovery', durationType: 'time', durationValue: 120, targetType: 'no_target' },
  ],
});
const FIVE_BY_ONE = { dayOfWeek: 2, name: 'חזרות', description: 'האחרונה הכי חזקה.', steps: [run(1, 'warmup', 2000, 340), reps(2, 5, 1000, 245), run(3, 'cooldown', 2000, 340)] };
const TEMPO = { dayOfWeek: 4, name: 'טמפו', steps: [run(1, 'warmup', 2000, 340), reps(2, 3, 2000, 270), run(3, 'cooldown', 1500, 340)] };

function plan(athleteId: string | null, workouts: unknown[], weekStart = WEEK) {
  db.tables.weekly_plans.push({
    id: uid(), coach_id: COACH_ID, athlete_id: athleteId, week_start_date: weekStart,
    parsed_workouts: { workouts }, status: 'pushed', created_at: '2026-10-10T10:00:00Z',
  });
}

/** `days` days of runs before today, with a 30-minute test when `tested`. */
function history(days: number, tested: boolean) {
  if (tested) {
    db.tables.academy_tests.push({ id: uid(), athlete_id: TRAINEE, test_date: '2026-09-16', protocol: '30min', duration_sec: 1800, distance_m: 7143, excluded_reason: null, status: 'approved' });
  }
  for (let i = days; i >= 1; i -= 1) {
    db.tables.athlete_activities.push({
      id: uid(), athlete_id: TRAINEE, start_time: `${day(-i)}T06:30:00`, activity_type: 'running',
      distance: 8000, duration: 2700, moving_duration: 2700, average_hr: 145, max_hr: 178, laps: null,
      splits: Array.from({ length: 8 }, () => ({ distance: 1000, duration: 337, averageHR: 145 })),
    });
  }
  for (let i = 0; i < 31; i += 1) {
    db.tables.athlete_wellness.push({ athlete_id: TRAINEE, date: day(-i), sleep_seconds: 26000 + (i % 5) * 600, resting_hr: 46 + (i % 5) });
  }
}

function seed() {
  db = createMemoryDb({ schema: SCHEMA });
  db.tables.groups.push({ id: GROUP, name: 'Group B 2:30-2:45', coach_id: COACH_ID });
  db.tables.athletes.push(
    { id: TRAINEE, coach_id: COACH_ID, name: 'Shahar Glazner', gender: 'male', group_id: GROUP, is_academy: true, academy_coach_id: COACH, academy_band_id: null, avatar_url: null },
    { id: OTHER, coach_id: COACH_ID, name: 'Dana', gender: 'female', group_id: GROUP, is_academy: true, academy_coach_id: COACH, academy_band_id: null, avatar_url: null },
    { id: COACH, coach_id: COACH_ID, name: 'Sahar Ben Ami', gender: 'male', group_id: null, is_academy: false, academy_coach_id: null, academy_band_id: null, avatar_url: null },
  );
}

const as = (athleteId: string, extra: Record<string, unknown> = {}) =>
  requireCallerForAthlete.mockResolvedValue({ denied: null, caller: { athleteId, isStaff: athleteId !== TRAINEE, isSuperUser: false, role: 'runner', ...extra } });

beforeEach(() => {
  seed();
  as(TRAINEE);
});

describe('the request', () => {
  it('needs an athlete', async () => {
    expect((await get('')).status).toBe(400);
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

  it('is "not a member" for a club runner, with no academy numbers', async () => {
    db.tables.athletes[0].is_academy = false;
    const body = await (await get(`athleteId=${TRAINEE}`)).json();
    expect(body).toEqual({ isMember: false });
  });
});

describe('the day', () => {
  it('a workout today (1): the card from the trainee\'s OWN row, with the coach, form, body and ⚡', async () => {
    history(100, true);
    plan(TRAINEE, [FIVE_BY_ONE, TEMPO]);
    db.tables.workout_deliveries.push({ athlete_id: TRAINEE, workout_date: TODAY, status: 'success' });
    as(COACH);
    const res = await get(`athleteId=${TRAINEE}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      isMember: true, dayState: 'workout', focus: 'today', date: TODAY, weekStart: WEEK,
      athlete: { id: TRAINEE, gender: 'male' },
      coach: { id: COACH, name: 'Sahar Ben Ami' },
      card: { title: '5 × 1 ק״מ', paceSec: 245, paceOf: 'reps', kind: 'quality', onWatch: true, note: 'האחרונה הכי חזקה.' },
      form: { status: 'ok' },
      invitation: null,
      yesterday: null,
    });
    expect(body.card.expectedLoad).toBeGreaterThan(50);
    expect(body.body.rhr).toMatchObject({ date: TODAY, range: { lo: expect.any(Number), hi: expect.any(Number) } });
  });

  it('never picks another trainee\'s personal week, even a newer pushed one', async () => {
    history(100, true);
    plan(null, [{ ...TEMPO, dayOfWeek: 2, name: 'club tempo' }]);
    db.tables.weekly_plans.push({
      id: uid(), coach_id: COACH_ID, athlete_id: OTHER, week_start_date: WEEK,
      parsed_workouts: { workouts: [{ ...FIVE_BY_ONE, steps: [run(1, 'active', 20000, 300)] }] }, status: 'pushed', created_at: '2026-10-12T10:00:00Z',
    });
    const body = await (await get(`athleteId=${TRAINEE}`)).json();
    expect(body.dayState).toBe('workout');
    // The club's 3 × 2 km, not Dana's 20 km.
    expect(body.card.title).toBe('3 × 2 ק״מ');
    expect(body.card.distanceM).toBeLessThan(15000);
  });

  it('another trainee\'s week alone is "no plan" for this one', async () => {
    history(100, true);
    plan(OTHER, [FIVE_BY_ONE]);
    const body = await (await get(`athleteId=${TRAINEE}`)).json();
    expect(body).toMatchObject({ dayState: 'noPlan', card: null });
  });

  it('a rest day (1ב): "rest", tomorrow\'s session under it, never "no plan"', async () => {
    history(100, true);
    plan(TRAINEE, [{ ...FIVE_BY_ONE, dayOfWeek: 1 }, { ...TEMPO, dayOfWeek: 3 }]);
    const body = await (await get(`athleteId=${TRAINEE}`)).json();
    expect(body).toMatchObject({ dayState: 'rest', card: null, prevKind: 'quality' });
    expect(body.next).toMatchObject({ date: day(1), kind: 'quality' });
    expect(body.form.status === 'ok' ? body.form.sentenceKey : '').toMatch(/_rest$/);
  });

  it('no plan row at all (and none tomorrow): "no plan"', async () => {
    history(100, true);
    const body = await (await get(`athleteId=${TRAINEE}`)).json();
    expect(body).toMatchObject({ dayState: 'noPlan', card: null, next: null });
  });

  it('a new trainee (1ג): learning, the invitation on top, and yesterday\'s HR-estimated run', async () => {
    history(19, false);
    plan(TRAINEE, [{ dayOfWeek: 2, name: 'קל', steps: [run(1, 'active', 6000, 370)] }]);
    db.tables.academy_test_invitations.push({
      id: uid(), athlete_id: TRAINEE, protocol: '30min', proposed_slots: ['2026-10-20T03:30:00Z'], confirmed_slot: null, status: 'proposed', created_at: '2026-10-12T09:00:00Z',
    });
    const body = await (await get(`athleteId=${TRAINEE}`)).json();
    expect(body.form).toEqual({ status: 'learning', daysSeen: 19, daysLeft: 23 });
    expect(body.invitation).toEqual({ slot: '2026-10-20T03:30:00Z', status: 'proposed' });
    expect(body.yesterday).toMatchObject({ source: 'hr', km: 8 });
    expect(body.yesterday.load).toBeGreaterThan(0);
    expect(body.card).toMatchObject({ kind: 'easy', paceSec: 370, expectedLoad: null });
  });

  it('under view-as the loads are priced in memory and nothing is written', async () => {
    history(60, true);
    plan(TRAINEE, [FIVE_BY_ONE]);
    as(TRAINEE, { viewingAsBy: 'admin@club' });
    expect((await get(`athleteId=${TRAINEE}`)).status).toBe(200);
    expect(db.log.some(l => l.op !== 'select')).toBe(false);
  });
});
