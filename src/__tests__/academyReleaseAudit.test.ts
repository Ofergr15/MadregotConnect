import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';
import { toLibrarySteps, type BookStep } from '@/lib/academy/book-steps';
import { effortFromPace, effortFromZone } from '@/lib/academy/book-steps';
import { BAND_PACE_NOTE } from '@/lib/academy/day-send';

/**
 * THE RELEASE AUDIT (Ofer, 2026-10-20: "go over everything, check it all sits right and is
 * properly connected"): every chain of the coach-baseline build, over the real routes on one
 * in-memory database, with a fake Garmin that reads back like the real one. Chains:
 * (a) טופס התאמה → band (with its meaning) → required baseline → paceBasis 'coach' → watch;
 * (b) a manual zone → priced into the day → on the watch → a new test clears it, and says so;
 * (c) the group line → the group's session at the trainee's paces → sent → on the board and home;
 * (d) the whole group week → only days still ahead go out, one workout a day;
 * (e) the book → send → the library row unchanged; a saved entry needs a name AND a type;
 * (f) who sees what; (g) the file's results prefill the baseline.
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
vi.mock('@/lib/academy/loop-notify', () => ({ notifyPlanSaved: async () => {}, notifyMissedWeek: async () => {} }));

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
const setupRoute = await import('@/app/api/academy/trainee-setup/route');
const zonesRoute = await import('@/app/api/academy/zones/route');
const boardRoute = await import('@/app/api/academy/week-board/route');
const libraryRoute = await import('@/app/api/academy/library/route');
const today = await import('@/app/api/academy/today/route');
const dispatch = await import('@/app/api/academy/dispatch/route');
const copyWeekRoute = await import('@/app/api/academy/copy-week/route');
const missedWeekRoute = await import('@/app/api/academy/missed-week/route');
const { pushWeekToAthlete } = await import('@/lib/garmin/push-week');

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
const asSuperUser = () => { who.caller = { ...caller(uid(), ['runner']), isSuperUser: true }; };

const ATHLETE_COLS = ['id', 'coach_id', 'name', 'email', 'gender', 'group_id', 'role', 'extra_roles', 'status', 'approved',
  'is_academy', 'academy_coach_id', 'academy_band_id', 'academy_pace_offset_sec', 'avatar_url', 'garmin_auth', 'academy_intake', 'academy_joined_on'];

function seed() {
  db = createMemoryDb({
    schema: {
      athletes: ATHLETE_COLS,
      academy_trainee_coaches: ['athlete_id', 'coach_id', 'since', 'created_at'],
      academy_bands: ['id', 'band_number', 'name', 'goal', 'pace_profile', 'active', 'updated_at'],
      groups: ['id', 'name', 'coach_id'],
      weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'original_input', 'parsed_workouts', 'status', 'created_at'],
      workout_deliveries: ['id', 'athlete_id', 'plan_id', 'workout_date', 'status', 'garmin_workout_id', 'workout_key', 'error_message', 'created_at', 'workout_name', 'workout_data'],
      academy_tests: ['id', 'athlete_id', 'test_date', 'protocol', 'duration_sec', 'distance_m', 'excluded_reason', 'status', 'notes', 'author_id', 'approved_by', 'approved_at'],
      academy_coach_decisions: ['id', 'athlete_id', 'coach_id', 'kind', 'action', 'basis_test_date', 'week_start', 'changes', 'evidence', 'reason', 'created_at'],
      athlete_activities: ['id', 'athlete_id', 'start_time', 'activity_type', 'distance', 'duration', 'moving_duration', 'average_hr', 'max_hr', 'laps', 'splits', 'source', 'garmin_workout_id'],
      athlete_wellness: ['athlete_id', 'date', 'sleep_seconds', 'resting_hr'],
      academy_test_invitations: ['id', 'athlete_id', 'protocol', 'proposed_slots', 'confirmed_slot', 'status', 'created_at'],
      academy_candidates: ['id', 'athlete_id', 'created_at'],
      academy_characterizations: ['candidate_id', 'goal_type', 'target_race', 'target_race_date', 'available_days'],
      academy_workout_library: ['id', 'scope', 'owner_id', 'name', 'kind', 'notes', 'steps', 'use_count', 'last_used_at', 'archived_at', 'created_at'],
    },
    defaults: {
      weekly_plans: () => ({ id: uid(), created_at: new Date().toISOString() }),
      workout_deliveries: () => ({ id: uid(), created_at: new Date().toISOString() }),
      academy_coach_decisions: () => ({ id: uid(), created_at: new Date().toISOString() }),
      academy_workout_library: () => ({ id: uid(), created_at: new Date().toISOString(), use_count: 0 }),
    },
  });
  // As in prod: band 4 carries only its marathon goal, no pace.
  db.tables.academy_bands.push({ id: BAND4, band_number: 4, name: 'דבוקה 4', goal: 'סאב 3', active: true, pace_profile: { marathonGoal: '2:59', description: 'מרתון חזק עם רצון לסאב 3' } });
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


const req = (url: string, method = 'GET', b?: unknown) => new Request(`http://x${url}`, { method, ...(b ? { body: JSON.stringify(b) } : {}) });
const json = async (r: Response | Promise<Response>) => (await r).json();
const stepsAt = (steps: BookStep[]) => toLibrarySteps(steps);
const sendDay = (athleteId: string, date: string, steps: unknown, extra: Record<string, unknown> = {}) => dayPlan.POST(req('/api/academy/day-plan', 'POST', { date, recipients: [athleteId], workout: { name: 'x', notes: null, steps }, ...extra }));
/** The centre of a stored step's pace band, sec/km. */
const centre = (s: { targetPaceMinPerKm?: number; targetPaceMaxPerKm?: number }) => Math.round(((s.targetPaceMinPerKm ?? 0) + (s.targetPaceMaxPerKm ?? 0)) / 2);
const flatSteps = (ws: Array<{ steps: unknown[] }>): any[] => ws.flatMap(w => (w.steps as any[]).flatMap(s => [s, ...(s.repeatSteps ?? [])]));

/** A club week, as the planner stores it: one lane-free set of days. */
const clubWeek = (days: Array<{ dayOfWeek: number; name: string; km: number }>) => {
  const id = uid();
  db.tables.weekly_plans.push({ id, coach_id: COACH_ID, athlete_id: null, week_start_date: WEEK, original_input: null, status: 'pushed', created_at: '2026-10-10T10:00:00Z',
    parsed_workouts: { workouts: days.map(d => ({ dayOfWeek: d.dayOfWeek, name: d.name, steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: d.km * 1000, targetType: 'pace', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 320 }] })) } });
  return id;
};

describe('(a) טופס התאמה → band → required baseline → paceBasis "coach" → the watch', () => {
  it('runs end to end for a trainee with no test', async () => {
    asCoach();
    let s = await json(setupRoute.GET(req(`/api/academy/trainee-setup?athleteId=${UNTESTED}`)));
    expect(s.missing).toContain('baseline');
    expect(s.bands.find((b: { id: string }) => b.id === BAND4).description).toBe('מרתון חזק עם רצון לסאב 3');
    // No test, no band pace: nothing can be sent yet.
    expect((await json(sendDay(UNTESTED, TODAY, stepsAt(model)))).results[0]).toMatchObject({ status: 'skipped', reason: 'no-test' });

    expect((await setupRoute.PUT(req('/api/academy/trainee-setup', 'PUT', { athleteId: UNTESTED, bandId: BAND4, baseline: { distance: '10k', sec: 2520, origin: 'race' } }))).status).toBe(200);
    s = await json(setupRoute.GET(req(`/api/academy/trainee-setup?athleteId=${UNTESTED}`)));
    expect(s.missing).not.toContain('baseline');

    const plan = await json(dayPlan.GET(req(`/api/academy/day-plan?athleteId=${UNTESTED}&date=${TODAY}`)));
    expect(plan.trainee).toMatchObject({ paceBasis: 'coach', thresholdSec: 247 });
    const sent = await json(sendDay(UNTESTED, TODAY, stepsAt(model)));
    expect(sent.results[0]).toMatchObject({ athleteId: UNTESTED, status: 'sent', paceBasis: 'coach' });
    expect(garmin.account.size).toBe(1);
  });
});

describe('(b) a manual zone → priced → on the watch → a new test clears it', () => {
  const thresholdDay: BookStep[] = [
    { kind: 'run', role: 'warmup', length: { measure: 'time', value: 900 }, effort: effortFromZone('easy') },
    { kind: 'reps', count: 4, work: { measure: 'distance', value: 1000 }, effort: effortFromZone('threshold'), rest: { length: { measure: 'time', value: 90 }, mode: 'jog' } },
  ];
  it('the watch gets the coach\'s pace, and a later test puts the suggested one back', async () => {
    asCoach();
    // Ofer's test: 4:37 threshold. The coach sets threshold to 4:30 by hand.
    expect((await zonesRoute.PUT(req('/api/academy/zones', 'PUT', { athleteId: TRAINEE, zones: { threshold: 270 } }))).status).toBe(200);
    expect((await json(sendDay(TRAINEE, TODAY, stepsAt(thresholdDay)))).results[0].status).toBe('sent');
    const row = db.tables.weekly_plans.find(p => p.athlete_id === TRAINEE)!;
    const work = flatSteps(row.parsed_workouts.workouts).filter(st => st.type === 'interval' && st.targetPaceMinPerKm);
    expect(work.length).toBeGreaterThan(0);
    expect(Math.abs(centre(work[0]) - 270)).toBeLessThanOrEqual(2);
    expect(db.tables.workout_deliveries.some(d => d.athlete_id === TRAINEE && d.status === 'success')).toBe(true);

    db.tables.academy_tests.push({ id: uid(), athlete_id: TRAINEE, test_date: '2026-10-12', protocol: '30min', duration_sec: 1800, distance_m: 6700, excluded_reason: null, status: 'approved' });
    const z = await json(zonesRoute.GET(req(`/api/academy/zones?athleteId=${TRAINEE}`)));
    expect(z.zones.find((r: { zone: string }) => r.zone === 'threshold').set).toBeNull();
    expect(z.lapsed).toMatchObject({ since: '2026-10-12', zones: { threshold: 270 } });
  });
});

describe('(c) the group line → the group\'s session at the trainee\'s paces → board and home', () => {
  it('takes Tuesday\'s group session, sends it, and both screens say it is on the watch', async () => {
    clubWeek([{ dayOfWeek: 2, name: 'שלישי', km: 10 }, { dayOfWeek: 4, name: 'חמישי', km: 8 }]);
    asCoach();
    const board = await json(boardRoute.GET(req(`/api/academy/week-board?athleteId=${TRAINEE}&weekStart=${WEEK}`)));
    expect(board.groupDays.map((g: { date: string }) => g.date)).toEqual(['2026-10-13', '2026-10-15']);

    const plan = await json(dayPlan.GET(req(`/api/academy/day-plan?athleteId=${TRAINEE}&date=${TODAY}`)));
    expect(plan.senior.today).toBeTruthy();
    expect((await json(sendDay(TRAINEE, TODAY, plan.senior.today.steps))).results[0].status).toBe('sent');

    const after = await json(boardRoute.GET(req(`/api/academy/week-board?athleteId=${TRAINEE}&weekStart=${WEEK}`)));
    expect(after.workouts.find((w: { date: string }) => w.date === TODAY)).toMatchObject({ onWatch: true });
    asTrainee();
    expect(await json(home(TRAINEE))).toMatchObject({ dayState: 'workout', card: { onWatch: true } });
  });
});

describe('(d) the whole group week → only days ahead, one workout a day', () => {
  it('writes the week, pushes Tuesday on, and the club\'s Thursday on the watch is replaced', async () => {
    const club = clubWeek([{ dayOfWeek: 0, name: 'ראשון', km: 12 }, { dayOfWeek: 2, name: 'שלישי', km: 10 }, { dayOfWeek: 4, name: 'חמישי', km: 8 }]);
    // The club's Thursday is already on his watch.
    db.tables.workout_deliveries.push({ id: uid(), athlete_id: TRAINEE, plan_id: club, workout_date: '2026-10-15', status: 'success', garmin_workout_id: '777', workout_key: null, workout_data: {} });
    garmin.account.add('777');
    asCoach();
    const res = await json(copyWeekRoute.POST(req('/api/academy/copy-week', 'POST', { fromClub: true, athleteId: TRAINEE, weekStart: WEEK, send: true })));
    expect(res.results[0].status).not.toBe('failed');
    const mine = db.tables.weekly_plans.find(p => p.athlete_id === TRAINEE)!;
    expect(mine.parsed_workouts.workouts.map((w: { dayOfWeek: number }) => w.dayOfWeek).sort()).toEqual([0, 2, 4]);
    const dates = db.tables.workout_deliveries.filter(d => d.athlete_id === TRAINEE && d.status === 'success').map(d => d.workout_date).sort();
    expect(dates).toEqual(['2026-10-13', '2026-10-15']); // Sunday has passed
    expect(garmin.account.has('777')).toBe(false);
  });
});

describe('(e) the book: send, the row unchanged, and a saved entry needs a name and a type', () => {
  it('sends an entry without touching it, and refuses a nameless or typeless save', async () => {
    const steps = stepsAt(model);
    const entry = { id: uid(), scope: 'academy', owner_id: MANAGER, name: '5 × 1 ק״מ', kind: 'intervals', notes: null, steps, use_count: 2, last_used_at: null, archived_at: null };
    db.tables.academy_workout_library.push(JSON.parse(JSON.stringify(entry)));
    asCoach();
    const edited = JSON.parse(JSON.stringify(steps));
    edited[1].repeatCount = 6;
    expect((await json(sendDay(TRAINEE, TODAY, edited, { entryId: entry.id }))).results[0].status).toBe('sent');
    const row = db.tables.academy_workout_library.find(r => r.id === entry.id)!;
    expect(row.steps).toEqual(entry.steps);
    expect(row.name).toBe(entry.name);

    const save = (b: Record<string, unknown>) => libraryRoute.POST(req('/api/academy/library', 'POST', { steps, scope: 'mine', ...b }));
    expect((await save({ name: '', kind: 'intervals' })).status).toBe(400);
    expect((await save({ name: '6 × 1 ק״מ' })).status).toBe(400);
    expect((await save({ name: '6 × 1 ק״מ', kind: 'intervals' })).status).toBe(200);
  });
});

describe('(f) who sees what', () => {
  it('the manager and a super user see the coach screens; the trainee does not', async () => {
    db.tables.academy_tests.push({ id: uid(), athlete_id: UNTESTED, test_date: '2026-10-12', protocol: 'coach_baseline', duration_sec: 1800, distance_m: 7287, excluded_reason: null, status: 'approved' });
    asManager();
    expect((await zonesRoute.GET(req(`/api/academy/zones?athleteId=${TRAINEE}`))).status).toBe(200);
    expect((await setupRoute.GET(req(`/api/academy/trainee-setup?athleteId=${UNTESTED}`))).status).toBe(200);
    asSuperUser();
    expect((await zonesRoute.GET(req(`/api/academy/zones?athleteId=${TRAINEE}`))).status).toBe(200);
    asTrainee();
    expect((await zonesRoute.GET(req(`/api/academy/zones?athleteId=${TRAINEE}`))).status).toBe(403);
    expect((await setupRoute.GET(req(`/api/academy/trainee-setup?athleteId=${TRAINEE}`))).status).toBe(403);
    const own = await json(boardRoute.GET(req(`/api/academy/week-board?athleteId=${TRAINEE}&weekStart=${WEEK}`)));
    expect(own.canPlan).toBe(false);
    expect(own.groupDays).toBeUndefined();
    asOtherCoach();
    expect((await zonesRoute.GET(req(`/api/academy/zones?athleteId=${TRAINEE}`))).status).toBe(403);
  });
});

describe('(g) the file\'s results prefill the baseline', () => {
  it('reads academy_intake.sheet_results exactly as the SQL writes it', async () => {
    const t = db.tables.athletes.find(a => a.id === UNTESTED)!;
    t.academy_intake = { sheet_results: { '5k': 1500, '10k': 2760, hm: 6000, m: 14100 } };
    asCoach();
    const s = await json(setupRoute.GET(req(`/api/academy/trainee-setup?athleteId=${UNTESTED}`)));
    expect(s.sheetResults).toEqual({ '5k': 1500, '10k': 2760, hm: 6000, m: 14100 });
    expect(s.suggestion).toEqual({ pick: '10k', sec: 2760, outliers: ['5k'] });
  });
});
