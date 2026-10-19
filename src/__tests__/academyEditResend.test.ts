import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';
import { toLibrarySteps, type BookStep } from '@/lib/academy/book-steps';
import { effortFromPace, effortFromZone } from '@/lib/academy/book-steps';
const effortPace = (min: number, max: number) => effortFromPace((min + max) / 2, 277);
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
const chat = vi.hoisted(() => ({ messages: new Map<string, { text: string; workout_date?: string }>(), sends: 0, updates: 0 }));
vi.mock('@/lib/stream/server', async (orig) => ({
  ...(await orig<object>()),
  upsertStreamUsersFromAthletes: async () => {},
  getStreamServerClient: () => ({
    channel: () => ({
      create: async () => ({}),
      addMembers: async () => ({}),
      sendMessage: async (m: { id: string; text: string; workout_date?: string }) => {
        if (chat.messages.has(m.id)) throw new Error('duplicate message id');
        chat.sends += 1; chat.messages.set(m.id, { text: m.text, workout_date: m.workout_date });
      },
    }),
    updateMessage: async (m: { id: string; text: string; workout_date?: string }) => { chat.updates += 1; chat.messages.set(m.id, { text: m.text, workout_date: m.workout_date }); },
  }),
}));
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
  // As in prod: band 4 carries only its marathon goal, no pace.
  db.tables.academy_bands.push({ id: BAND4, band_number: 4, name: 'דבוקה 4', goal: 'סאב 3', pace_profile: { marathonGoal: '2:59' } });
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


const editModel: BookStep[] = [
  { kind: 'run', role: 'warmup', length: { measure: 'time', value: 900 }, effort: effortFromZone('easy') },
  { kind: 'reps', count: 6, work: { measure: 'distance', value: 1000 }, effort: effortPace(245, 270), rest: { length: { measure: 'time', value: 120 }, mode: 'jog' } },
  { kind: 'run', role: 'cooldown', length: { measure: 'time', value: 600 }, effort: effortFromZone('easy') },
];
const sendAs = (name: string, m: BookStep[], notes: string | null) => dayPlan.POST(new Request('http://x/api/academy/day-plan', {
  method: 'POST', body: JSON.stringify({ date: TODAY, recipients: [TRAINEE], workout: { name, notes, steps: toLibrarySteps(m) } }),
}));

describe('edit a sent day and send it again', () => {
  beforeEach(() => { chat.messages.clear(); chat.sends = 0; chat.updates = 0; });

  it('replaces the workout on the watch, keeps one delivery, and edits the thread line in place', async () => {
    asCoach();
    expect((await (await sendAs('5 × 1 ק״מ', model, null)).json()).results[0].status).toBe('sent');
    expect(garmin.account.size).toBe(1);
    expect(chat.sends).toBe(1);

    // The coach re-opens the day: it comes back as an editable draft, name and note kept.
    const day = await (await dayPlan.GET(new Request(`http://x/api/academy/day-plan?athleteId=${TRAINEE}&date=${TODAY}`))).json();
    expect(day.existingEdit).toMatchObject({ name: '5 × 1 ק״מ' });
    expect(Array.isArray(day.existingEdit.model)).toBe(true);

    // Edited (a sixth rep, a warm-up, a cool-down, a note) and sent again.
    const again = await (await sendAs('6 × 1 ק״מ', editModel, 'האחרונה הכי חזקה')).json();
    expect(again.results[0].status).toBe('sent');

    // The watch holds the new one only.
    expect(garmin.account.size).toBe(1);
    const live = db.tables.workout_deliveries.filter(d => d.athlete_id === TRAINEE && d.workout_date === TODAY && d.status === 'success');
    expect(live).toHaveLength(1);
    // …and it is the new workout, the one now on the account.
    expect(garmin.account.has(String(live[0].garmin_workout_id))).toBe(true);
    expect(db.tables.workout_deliveries.filter(d => d.athlete_id === TRAINEE && d.workout_date === TODAY)).toHaveLength(1);

    // One plan row, that day replaced inside it.
    const rows = db.tables.weekly_plans.filter(p => p.athlete_id === TRAINEE && p.week_start_date === WEEK);
    expect(rows).toHaveLength(1);
    const tuesday = rows[0].parsed_workouts.workouts.filter((w: { dayOfWeek: number }) => w.dayOfWeek === 2);
    expect(tuesday).toHaveLength(1);
    expect(tuesday[0].name).toBe('6 × 1 ק״מ');
    expect(tuesday[0].description).toContain('האחרונה הכי חזקה');

    // The thread: the same line, edited — not a second one.
    expect(chat.sends).toBe(1);
    expect(chat.updates).toBe(1);
    expect(chat.messages.size).toBe(1);
    const [line] = [...chat.messages.values()];
    expect(line.text).toContain('6 × 1 ק״מ');
    expect(line.workout_date).toBe(TODAY);
  });
});
