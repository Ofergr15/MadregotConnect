import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';
import { getDisplayWeekStart } from '@/lib/plans/workout-parsing';

/**
 * QA 11-18 (2.41.500), the two gaps left after postLoginPath:
 *  1. every post-login landing goes through postLoginPath (the personal link /welcome?t=,
 *     the already-signed-in open, the password logins, the setup gate's "לאפליקציה");
 *  2. an academy-only trainee (academy, no club group) gets no CLUB rows from the feed's
 *     club-plan cards' APIs (/api/dashboard/weekly, /api/my-watch), a club member still does.
 */

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('every post-login landing uses postLoginPath', () => {
  const files = [
    'components/auth/EmailCodeSheet.tsx',
    'app/auth/resolve/page.tsx',
    'app/welcome/page.tsx',
    'components/auth/EmailCodeLogin.tsx',
    'app/admin/login/page.tsx',
    'components/setup/SetupGate.tsx',
  ];
  for (const f of files) {
    it(f, () => {
      const s = read(f);
      expect(s).toMatch(/import \{ postLoginPath \} from '@\/lib\/auth\/landing'/);
      expect(s).toMatch(/postLoginPath\(/);
    });
  }
  it('no sign-in screen hard-codes /feed any more', () => {
    for (const f of ['app/welcome/page.tsx', 'app/page.tsx', 'app/admin/login/page.tsx', 'components/auth/EmailCodeSheet.tsx', 'app/auth/resolve/page.tsx']) {
      expect(read(f)).not.toMatch(/router\.(replace|push)\('\/feed'\)/);
    }
  });
  it('the feed hides the club-plan cards for an academy-only reader', () => {
    expect(read('app/(app)/feed/page.tsx')).toMatch(/!isAcademyOnly && <>[\s\S]*<NextSessionCard \/>[\s\S]*<WeekWatchCard \/>[\s\S]*<\/>\}/);
  });
});

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
const who = vi.hoisted(() => ({ id: '' }));
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<object>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: who.id } }),
}));
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<object>()),
  requireAthlete: async () => ({ ok: true, user: { athleteId: who.id } }),
}));
vi.mock('@/lib/day-session/week-merge', async (orig) => ({
  ...(await orig<object>()),
  daySessionWorkouts: async () => [],
}));
vi.mock('@/lib/watch/own-week', async (orig) => ({
  ...(await orig<object>()),
  providerFor: async () => 'garmin',
}));

const weekly = await import('@/app/api/dashboard/weekly/route');
const myWatch = await import('@/app/api/my-watch/route');
const { loadOwnWeek } = await import('@/lib/watch/own-week');

const TRAINEE = uid();
const RUNNER = uid();
const GROUP = uid();
const week = getDisplayWeekStart(new Date());
const clubWeek = { workouts: [{ dayOfWeek: 0, name: 'Club long', distance: '20 ק"מ', type: 'long', steps: [] }, { dayOfWeek: 3, name: 'Club tempo', distance: '12 ק"מ', type: 'tempo', steps: [] }] };

beforeEach(() => {
  db = createMemoryDb({
    schema: {
      athletes: ['id', 'name', 'garmin_auth', 'is_academy', 'group_id', 'groups'],
      weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'parsed_workouts', 'status', 'created_at'],
      workout_deliveries: ['id', 'athlete_id', 'plan_id', 'workout_date', 'workout_key', 'status', 'error_message', 'workout_data', 'created_at', 'device_confirmed_at'],
      groups: ['id', 'pace_profile', 'coach_id'],
    },
  });
  db.tables.athletes.push(
    { id: TRAINEE, name: 'T', garmin_auth: { t: 1 }, is_academy: true, group_id: null, groups: null },
    { id: RUNNER, name: 'R', garmin_auth: { t: 1 }, is_academy: false, group_id: GROUP, groups: null },
  );
  const planId = uid();
  db.tables.weekly_plans.push({ id: planId, coach_id: COACH_ID, athlete_id: null, week_start_date: week, parsed_workouts: clubWeek, status: 'pushed', created_at: '2026-11-15T00:00:00Z' });
  // The club week went out (someone has a confirmed delivery), so a club member is judged against it.
  db.tables.workout_deliveries.push({ id: uid(), athlete_id: uid(), plan_id: planId, workout_date: week, workout_key: null, status: 'success', error_message: null, workout_data: null, created_at: '2026-11-15T00:00:00Z', device_confirmed_at: null });
});

const getWeekly = async () => (await weekly.GET(new Request('http://x/api/dashboard/weekly'))).json();
const getWatch = async () => (await myWatch.GET(new Request('http://x/api/my-watch'))).json();

describe('/api/dashboard/weekly', () => {
  it('a club member still gets the club week', async () => {
    who.id = RUNNER;
    const r = await getWeekly();
    expect(r.hasPlan).toBe(true);
    expect(r.sessions.length).toBeGreaterThan(0);
  });
  it('an academy-only trainee with no plan gets no club rows', async () => {
    who.id = TRAINEE;
    const r = await getWeekly();
    expect(r.hasPlan).toBe(false);
    expect(r.hasClubPlan).toBe(false);
    expect(r.sessions).toEqual([]);
    expect(r.weeklyVolumes).toEqual([]);
  });
  it("an academy-only trainee still gets their own week", async () => {
    who.id = TRAINEE;
    db.tables.weekly_plans.push({ id: uid(), coach_id: COACH_ID, athlete_id: TRAINEE, week_start_date: week, parsed_workouts: { workouts: [{ dayOfWeek: 2, name: 'Mine', distance: '8 ק"מ', type: 'easy', steps: [] }] }, status: 'pushed', created_at: '2026-11-15T00:00:00Z' });
    const r = await getWeekly();
    expect(r.hasPlan).toBe(true);
    expect(r.sessions.map((s: { name?: string }) => s.name)).not.toContain('Club long');
  });
});

describe('/api/my-watch and loadOwnWeek', () => {
  it('a club member: the club plan, and the club week judged for "not on the watch"', async () => {
    who.id = RUNNER;
    expect((await loadOwnWeek(RUNNER, week)).plan).toBeTruthy();
    const r = await getWatch();
    expect(r.hasPlan).toBe(true);
    expect(r.missing).not.toBeNull();
  });
  it('an academy-only trainee: no club plan and no "not on the watch" warning', async () => {
    who.id = TRAINEE;
    expect((await loadOwnWeek(TRAINEE, week)).plan).toBeNull();
    const r = await getWatch();
    expect(r.hasPlan).toBe(false);
    expect(r.missing).toBeNull();
  });
});
