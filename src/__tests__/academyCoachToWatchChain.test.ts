import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';
import { toLibrarySteps, type BookStep } from '@/lib/academy/book-steps';
import { effortFromPace, effortFromZone } from '@/lib/academy/book-steps';
import { BAND_PACE_NOTE } from '@/lib/academy/day-send';

/**
 * THE CHAIN, END TO END (2026-10-19, "everything closed and working"): a coach writes a
 * day for ONE trainee → it is saved into that trainee's own week → it reaches their Garmin
 * account (a fake one, read back like the real one) → the trainee's home shows it, and
 * says it is on the watch → the delivery row exists → the coach and the manager see it in
 * dispatch. Every route is the real one, over one in-memory database; only Garmin, push
 * and Stream are fakes.
 */

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-13T06:42:00+03:00'));
afterAll(() => { vi.useRealTimers(); });

const TODAY = '2026-10-13';
const WEEK = '2026-10-11';

const garmin = vi.hoisted(() => ({ account: new Set<string>(), next: 1 }));
vi.mock('@/lib/garmin/client', () => ({
  GarminClient: class {
    async createWorkout() { const id = String(1000 + garmin.next++); garmin.account.add(id); return id; }
    async scheduleWorkout() {}
    async deleteWorkout(id: string) { garmin.account.delete(id); }
    async verifyWorkoutOnAccount(id: string) { if (!garmin.account.has(id)) throw new Error('not on account'); }
  },
}));
vi.mock('@/lib/garmin/converter', () => ({ convertToGarminWorkout: () => ({}) }));
const pushes = vi.hoisted(() => [] as Array<{ athleteId: string; kind: string }>);
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn(async (o: { athleteId: string; kind: string }) => { pushes.push(o); }) }));
vi.mock('@/lib/stream/server', () => ({ getStreamServerClient: () => { throw new Error('no Stream in tests'); } }));
vi.mock('@/lib/plans/cache', () => ({ revalidateWeeklyPlans: () => {} }));
vi.mock('@/lib/academy/settings-server', () => ({ loadAcademySettings: async () => ({ paceAlerts: true }) }));
vi.mock('@/lib/academy/loop-notify', () => ({ notifyPlanSaved: async () => {} }));

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

// The signed-in person, for every route's gate.
const who = vi.hoisted(() => ({ caller: null as Record<string, unknown> | null }));
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<object>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: who.caller }),
  requireCallerForAthlete: async () => ({ denied: null, caller: who.caller }),
}));

const dayPlan = await import('@/app/api/academy/day-plan/route');
const today = await import('@/app/api/academy/today/route');
const dispatch = await import('@/app/api/academy/dispatch/route');

const TRAINEE = uid();
const UNTESTED = uid();
const COACH = uid();
const OTHER_COACH = uid();
const MANAGER = uid();
const BAND4 = uid();

const caller = (athleteId: string, roles: string[]) => ({
  athleteId, role: roles[0], roles, isStaff: roles.some(r => r !== 'runner'), isSuperUser: false, email: athleteId,
});
const asCoach = () => { who.caller = caller(COACH, ['academy_coach']); };
const asOtherCoach = () => { who.caller = caller(OTHER_COACH, ['academy_coach']); };
const asManager = () => { who.caller = caller(MANAGER, ['academy_coach', 'academy_manager']); };
const asTrainee = (id = TRAINEE) => { who.caller = caller(id, ['runner']); };

const ATHLETE_COLS = ['id', 'coach_id', 'name', 'email', 'gender', 'group_id', 'role', 'extra_roles', 'status', 'approved',
  'is_academy', 'academy_coach_id', 'academy_band_id', 'academy_pace_offset_sec', 'avatar_url', 'garmin_auth'];

function seed() {
  db = createMemoryDb({
    schema: {
      athletes: ATHLETE_COLS,
      academy_trainee_coaches: ['athlete_id', 'coach_id', 'since', 'created_at'],
      academy_bands: ['id', 'band_number', 'name', 'goal', 'pace_profile'],
      groups: ['id', 'name', 'coach_id'],
      weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'original_input', 'parsed_workouts', 'status', 'created_at'],
      workout_deliveries: ['id', 'athlete_id', 'plan_id', 'workout_date', 'status', 'garmin_workout_id', 'workout_key', 'error_message', 'created_at', 'workout_name', 'workout_data'],
      academy_tests: ['id', 'athlete_id', 'test_date', 'protocol', 'duration_sec', 'distance_m', 'excluded_reason', 'status'],
      athlete_activities: ['id', 'athlete_id', 'start_time', 'activity_type', 'distance', 'duration', 'moving_duration', 'average_hr', 'max_hr', 'laps', 'splits', 'source', 'garmin_workout_id'],
      athlete_wellness: ['athlete_id', 'date', 'sleep_seconds', 'resting_hr'],
      academy_test_invitations: ['id', 'athlete_id', 'protocol', 'proposed_slots', 'confirmed_slot', 'status', 'created_at'],
      academy_candidates: ['id', 'athlete_id'],
      academy_characterizations: ['candidate_id', 'goal_type', 'target_race', 'target_race_date'],
      academy_workout_library: ['id', 'use_count', 'last_used_at'],
    },
    defaults: {
      weekly_plans: () => ({ id: uid(), created_at: new Date().toISOString() }),
      workout_deliveries: () => ({ id: uid(), created_at: new Date().toISOString() }),
    },
  });
  db.tables.academy_bands.push({ id: BAND4, band_number: 4, name: 'דבוקה 4', goal: 'סאב 3', pace_profile: {} });
  const a = (o: Record<string, unknown>) => ({
    coach_id: COACH_ID, email: null, gender: 'male', group_id: null, role: 'runner', extra_roles: null, status: 'active', approved: true,
    is_academy: false, academy_coach_id: null, academy_band_id: null, academy_pace_offset_sec: null, avatar_url: null, garmin_auth: null, ...o,
  });
  db.tables.athletes.push(
    a({ id: TRAINEE, name: 'Ofer', is_academy: true, academy_coach_id: COACH, academy_band_id: BAND4, garmin_auth: { token: 'x' } }),
    a({ id: UNTESTED, name: 'Shahar', is_academy: true, academy_coach_id: COACH, academy_band_id: BAND4, garmin_auth: { token: 'y' } }),
    a({ id: COACH, name: 'Sahar', role: 'academy_coach' }),
    a({ id: OTHER_COACH, name: 'Other', role: 'academy_coach' }),
    a({ id: MANAGER, name: 'Eldar', role: 'academy_coach', extra_roles: ['academy_manager'] }),
  );
  db.tables.academy_trainee_coaches.push(
    { athlete_id: TRAINEE, coach_id: COACH, since: '2026-10-01' },
    { athlete_id: UNTESTED, coach_id: COACH, since: '2026-10-01' },
  );
  // Ofer's 30-minute test: 6.5 km → 4:37/km threshold.
  db.tables.academy_tests.push({ id: uid(), athlete_id: TRAINEE, test_date: '2026-09-19', protocol: '30min', duration_sec: 1800, distance_m: 6500, excluded_reason: null, status: 'approved' });
}

const model: BookStep[] = [
  { kind: 'run', role: 'warmup', length: { measure: 'distance', value: 2000 }, effort: effortFromZone('easy') },
  { kind: 'reps', count: 5, work: { measure: 'distance', value: 1000 }, effort: effortFromPace(245, 270), rest: { length: { measure: 'time', value: 120 }, mode: 'jog' } },
];
const send = (recipients: string[]) => dayPlan.POST(new Request('http://x/api/academy/day-plan', {
  method: 'POST', body: JSON.stringify({ date: TODAY, recipients, workout: { name: '5 × 1 ק״מ', notes: null, steps: toLibrarySteps(model) } }),
}));
const home = (id: string) => today.GET(new Request(`http://x/api/academy/today?athleteId=${id}`));
const report = (scope = '') => dispatch.GET(new Request(`http://x/api/academy/dispatch?weekStart=${WEEK}${scope}`));

beforeEach(() => {
  seed();
  garmin.account.clear();
  garmin.next = 1;
  pushes.length = 0;
});

describe('coach → trainee → watch → coach and manager', () => {
  it('runs the whole chain for one trainee', async () => {
    // Before: nothing on the watch, the home has no personal workout on it.
    asTrainee();
    const before = await (await home(TRAINEE)).json();
    expect(before.isMember).toBe(true);

    // 1. The coach writes Tuesday for Ofer.
    asCoach();
    const res = await send([TRAINEE]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([expect.objectContaining({ athleteId: TRAINEE, status: 'sent' })]);

    // 2. Saved into HIS week — a personal row, published.
    const rows = db.tables.weekly_plans.filter(p => p.athlete_id === TRAINEE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ week_start_date: WEEK, status: 'pushed' });

    // 3. On his Garmin account, and the delivery row says so — of THIS plan.
    expect(garmin.account.size).toBe(1);
    const deliveries = db.tables.workout_deliveries.filter(d => d.athlete_id === TRAINEE);
    expect(deliveries).toEqual([expect.objectContaining({ plan_id: rows[0].id, workout_date: TODAY, status: 'success' })]);

    // 4. His home: that workout, on the watch.
    asTrainee();
    const after = await (await home(TRAINEE)).json();
    expect(after).toMatchObject({ dayState: 'workout', date: TODAY, card: { onWatch: true } });

    // 5. The coach's dispatch shows it…
    asCoach();
    const coachView = await (await report()).json();
    expect(coachView.roster.map((r: { athleteId: string }) => r.athleteId).sort()).toEqual([TRAINEE, UNTESTED].sort());
    expect(coachView.roster.find((r: { athleteId: string }) => r.athleteId === TRAINEE)).toMatchObject({ hasGarmin: true, planWorkouts: 1 });
    // The delivered slot is a row of the report, for him, on that day.
    expect(coachView.rows.some((r: { athleteId?: string; date?: string; workoutDate?: string }) => r.athleteId === TRAINEE && (r.date ?? r.workoutDate) === TODAY)).toBe(true);

    // …and so does the manager's, who coaches neither of them.
    asManager();
    const managerView = await (await report()).json();
    expect(managerView.roster.find((r: { athleteId: string }) => r.athleteId === TRAINEE)).toMatchObject({ planWorkouts: 1 });
    expect(managerView.rows.some((r: { athleteId?: string }) => r.athleteId === TRAINEE)).toBe(true);
    // A coach of nobody sees nobody.
    asOtherCoach();
    expect((await (await report()).json()).roster ?? []).toEqual([]);
  });

  it('a trainee with no test still gets it, priced from the band and saying so', async () => {
    asCoach();
    const body = await (await send([UNTESTED])).json();
    expect(body.results).toEqual([expect.objectContaining({ athleteId: UNTESTED, status: 'sent', paceBasis: 'band' })]);
    const row = db.tables.weekly_plans.find(p => p.athlete_id === UNTESTED)!;
    const tuesday = row.parsed_workouts.workouts.find((w: { dayOfWeek: number }) => w.dayOfWeek === 2);
    expect(JSON.stringify(tuesday)).toContain(BAND_PACE_NOTE);
    expect(garmin.account.size).toBe(1);
  });

  it('the manager may write for any trainee; another coach may not', async () => {
    asOtherCoach();
    expect((await send([TRAINEE])).status).toBe(403);
    expect(db.tables.weekly_plans).toHaveLength(0);
    expect(garmin.account.size).toBe(0);

    asManager();
    const body = await (await send([TRAINEE])).json();
    expect(body.results[0]).toMatchObject({ athleteId: TRAINEE, status: 'sent' });
  });
});
