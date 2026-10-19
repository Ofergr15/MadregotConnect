import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';
import { isFixtureEmail, pickFeedbackRecipients } from '@/lib/notifications/feedback-recipients';

/**
 * The older composer's doors (2026-10-19): POST /api/plans with an `athlete_id` and
 * POST /api/garmin/push-workouts for a PERSONAL plan are held to the line day-plan
 * draws — an academy trainee's own week is their coaches' and the manager's to write,
 * not any staff account's. Club weeks keep their any-staff gate. Plus the feedback
 * recipients' pure half.
 */

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('@/lib/plans/cache', () => ({ revalidateWeeklyPlans: () => {} }));
const pushed = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/garmin/push-week', () => ({
  pushWeekToAthlete: async (a: { athlete: { id: string } }) => { pushed.push(a.athlete.id); return { athleteId: a.athlete.id, athleteName: '', status: 'success' }; },
}));
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn() }));
vi.mock('@/lib/academy/settings-server', () => ({ loadAcademySettings: async () => ({ paceAlerts: false }) }));

const who = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<object>()),
  requireSession: async () => ({ ok: true, user: who.user }),
}));

const plans = await import('@/app/api/plans/route');
const pushRoute = await import('@/app/api/garmin/push-workouts/route');

const TRAINEE = uid();
const RUNNER = uid();
const COACH = uid();
const CLUB_COACH = uid();
const MANAGER = uid();
const user = (athleteId: string, roles: string[]) => ({ athleteId, role: roles[0], roles, isStaff: true, isSuperUser: false, email: athleteId });

beforeEach(() => {
  pushed.length = 0;
  db = createMemoryDb({
    schema: {
      athletes: ['id', 'coach_id', 'name', 'email', 'garmin_auth', 'is_academy', 'status', 'group_id', 'academy_coach_id', 'academy_band_id', 'academy_pace_offset_sec'],
      academy_trainee_coaches: ['athlete_id', 'coach_id', 'since'],
      weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'original_input', 'parsed_workouts', 'status'],
      groups: ['id', 'pace_profile', 'coach_id'],
    },
    defaults: { weekly_plans: () => ({ id: uid() }) },
  });
  const a = (o: Record<string, unknown>) => ({ coach_id: COACH_ID, email: null, garmin_auth: { t: 1 }, is_academy: false, status: 'active', group_id: null, academy_coach_id: null, academy_band_id: null, academy_pace_offset_sec: null, ...o });
  db.tables.athletes.push(
    a({ id: TRAINEE, name: 'T', is_academy: true, academy_coach_id: COACH }),
    a({ id: RUNNER, name: 'R' }),
    a({ id: COACH, name: 'C' }), a({ id: CLUB_COACH, name: 'Y' }), a({ id: MANAGER, name: 'M' }),
  );
  db.tables.academy_trainee_coaches.push({ athlete_id: TRAINEE, coach_id: COACH, since: '2026-10-01' });
});

const savePlan = (athlete_id: string) => plans.POST(new Request('http://x/api/plans', {
  method: 'POST', body: JSON.stringify({ coach_id: COACH_ID, week_start_date: '2026-10-11', parsed_workouts: { workouts: [] }, athlete_id }),
}) as never);
const push = (body: Record<string, unknown>) => pushRoute.POST(new Request('http://x/api/garmin/push-workouts', {
  method: 'POST', body: JSON.stringify({ weekStartDate: '2026-10-11', workouts: [{ dayOfWeek: 2, name: 'x', steps: [] }], ...body }),
}) as never);

describe('POST /api/plans for one athlete', () => {
  it("a trainee's own week: their coach and the manager, not a club coach", async () => {
    who.user = user(CLUB_COACH, ['coach']);
    expect((await savePlan(TRAINEE)).status).toBe(403);
    expect(db.tables.weekly_plans).toHaveLength(0);
    who.user = user(COACH, ['academy_coach']);
    expect((await savePlan(TRAINEE)).status).toBe(201);
    who.user = user(MANAGER, ['academy_coach', 'academy_manager']);
    expect((await savePlan(TRAINEE)).status).toBe(201);
    // Saved twice, one row: the week is updated, not duplicated.
    expect(db.tables.weekly_plans.filter(p => p.athlete_id === TRAINEE)).toHaveLength(1);
  });

  it('a club runner is not the academy gate\'s business', async () => {
    who.user = user(CLUB_COACH, ['coach']);
    expect((await savePlan(RUNNER)).status).toBe(201);
  });
});

describe('POST /api/garmin/push-workouts', () => {
  it("a trainee's personal plan: refused to a club coach, delivered for their coach", async () => {
    const planId = uid();
    db.tables.weekly_plans.push({ id: planId, coach_id: COACH_ID, athlete_id: TRAINEE, week_start_date: '2026-10-11', parsed_workouts: { workouts: [] }, status: 'draft' });
    who.user = user(CLUB_COACH, ['coach']);
    expect((await push({ planId, athleteIds: [TRAINEE] })).status).toBe(403);
    expect(pushed).toEqual([]);
    who.user = user(COACH, ['academy_coach']);
    expect((await push({ planId, athleteIds: [TRAINEE, RUNNER] })).status).toBe(400);
    expect((await push({ planId, athleteIds: [TRAINEE] })).status).toBe(200);
    expect(pushed).toEqual([TRAINEE]);
  });

  it('the club week still goes to everyone, trainees included, from any staff', async () => {
    const planId = uid();
    db.tables.weekly_plans.push({ id: planId, coach_id: COACH_ID, athlete_id: null, week_start_date: '2026-10-11', parsed_workouts: { workouts: [] }, status: 'draft' });
    who.user = user(CLUB_COACH, ['coach']);
    expect((await push({ planId, athleteIds: [TRAINEE, RUNNER] })).status).toBe(200);
    expect(pushed.sort()).toEqual([TRAINEE, RUNNER].sort());
  });
});

describe('who hears flagged feedback', () => {
  it('academy: the coaches, then the managers; no coach → managers', () => {
    expect(pickFeedbackRecipients('t', { isAcademy: true, academyCoaches: ['c'], managers: ['m'], clubCoaches: ['y'] })).toEqual({ ids: ['c', 'm'], to: 'coach', academy: true });
    expect(pickFeedbackRecipients('t', { isAcademy: true, academyCoaches: [], managers: ['m', 't'], clubCoaches: [] })).toEqual({ ids: ['m'], to: 'managers', academy: true });
  });

  it('club: the club coaches; nobody → null, never the runner', () => {
    expect(pickFeedbackRecipients('r', { isAcademy: false, academyCoaches: [], managers: ['m'], clubCoaches: ['y', 'r'] })).toEqual({ ids: ['y'], to: 'coach', academy: false });
    expect(pickFeedbackRecipients('r', { isAcademy: false, academyCoaches: [], managers: [], clubCoaches: [] }).to).toBeNull();
  });

  it('the QA fixture is not a coach anyone hears through; a Strava sign-in is a person', () => {
    expect(isFixtureEmail('test-coach@madregot.local')).toBe(true);
    expect(isFixtureEmail('strava_1@strava.madregot.local')).toBe(false);
    expect(isFixtureEmail('yair@example.com')).toBe(false);
  });
});
