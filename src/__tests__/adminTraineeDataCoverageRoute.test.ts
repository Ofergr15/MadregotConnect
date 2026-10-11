import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';
import { cardVerdict, chipVerdict, loadStatusVerdict, panelVerdict } from '@/lib/academy/data-coverage';

/**
 * GET /api/admin/trainee-data-coverage — the prod data-coverage check Ofer runs himself.
 *
 * What only the route can get wrong: WHO may read it (admin or the super user, never under
 * view-as), that it WRITES NOTHING (every load priced in memory), that no credential leaves
 * it, and that each verdict is the screens' own: the same trainee read through
 * /api/academy/today, /api/academy/load and /api/academy/body gives the same verdicts.
 */

// Tuesday 13 October 2026, 06:45 in Israel — the scenario tester's clock.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-13T06:45:00+03:00'));
afterAll(() => { vi.useRealTimers(); });

const TODAY = '2026-10-13';
const WEEK = '2026-10-11';
const day = (offset: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const FULL = uid();
const NOWELL = uid();
const STRAVA = uid();
const RUNNER = uid();
const ADMIN = uid();
const GROUP = uid();
const SECRET = 'garmin-oauth-secret-do-not-leak';

const resolveVerifiedCaller = vi.fn();
const callerFor = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r),
  requireCallerForAthlete: async (_r: Request, _id: string) => ({ denied: null, caller: callerFor() }),
}));
vi.mock('@/lib/academy/pairing-server', () => ({ mayCoach: async () => true, isAcademyManager: () => false }));
vi.mock('@/lib/stream/server', () => ({ getStreamServerClient: () => { throw new Error('no Stream in tests'); } }));

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const { GET } = await import('@/app/api/admin/trainee-data-coverage/route');
const today = await import('@/app/api/academy/today/route');
const load = await import('@/app/api/academy/load/route');
const body = await import('@/app/api/academy/body/route');
const get = (q = '') => GET(new Request(`http://x/api/admin/trainee-data-coverage${q}`));

const SCHEMA: Record<string, string[]> = {
  athletes: [
    'id', 'coach_id', 'name', 'gender', 'group_id', 'is_academy', 'academy_coach_id', 'academy_band_id', 'avatar_url', 'status', 'role',
    'notification_prefs', 'max_hr_bpm', 'garmin_auth', 'strava_auth', 'garmin_last_sync_at', 'garmin_auth_failed_at', 'strava_last_sync_at', 'strava_auth_failed_at',
  ],
  groups: ['id', 'name', 'coach_id'],
  weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'parsed_workouts', 'status', 'created_at'],
  workout_deliveries: ['athlete_id', 'workout_date', 'status'],
  workout_feedback: ['athlete_id', 'feel', 'difficulty', 'created_at', 'garmin_activity_id'],
  athlete_wellness: ['athlete_id', 'date', 'sleep_seconds', 'resting_hr'],
  athlete_activities: ['id', 'athlete_id', 'start_time', 'activity_type', 'distance', 'duration', 'moving_duration', 'average_hr', 'max_hr', 'laps', 'splits', 'source', 'garmin_activity_id'],
  academy_tests: ['id', 'athlete_id', 'test_date', 'protocol', 'duration_sec', 'distance_m', 'excluded_reason', 'status'],
  academy_test_invitations: ['id', 'athlete_id', 'protocol', 'proposed_slots', 'confirmed_slot', 'status', 'created_at'],
  academy_candidates: ['id', 'athlete_id'],
  academy_characterizations: ['candidate_id', 'goal_type', 'target_race', 'target_race_date'],
  academy_bands: ['id', 'band_number', 'name', 'goal', 'pace_profile'],
  push_subscriptions: ['id', 'athlete_id'],
};

const pace = (sec: number) => ({ targetType: 'pace', targetPaceMinPerKm: sec, targetPaceMaxPerKm: sec });
const run = (order: number, type: string, metres: number, sec: number) => ({ order, type, durationType: 'distance', durationValue: metres, ...pace(sec) });
const EASY = { dayOfWeek: 2, name: 'קל', steps: [run(1, 'active', 8000, 330)] };

function athlete(id: string, name: string, extra: Record<string, unknown> = {}) {
  db.tables.athletes.push({
    id, coach_id: COACH_ID, name, gender: 'male', group_id: GROUP, is_academy: true, academy_coach_id: null, academy_band_id: null,
    avatar_url: null, status: 'active', role: 'runner', notification_prefs: null, max_hr_bpm: null,
    garmin_auth: null, strava_auth: null, garmin_last_sync_at: null, garmin_auth_failed_at: null, strava_last_sync_at: null, strava_auth_failed_at: null,
    ...extra,
  });
}

function runs(id: string, days: number, opts: { source: string; hr: boolean; laps: boolean }) {
  for (let i = days; i >= 1; i -= 1) {
    db.tables.athlete_activities.push({
      id: uid(), athlete_id: id, start_time: `${day(-i)}T06:30:00`, activity_type: 'running', source: opts.source, garmin_activity_id: null,
      distance: 8000, duration: 2700, moving_duration: 2700, average_hr: opts.hr ? 145 : null, max_hr: opts.hr ? 178 : null,
      laps: opts.laps ? Array.from({ length: 8 }, () => ({ distance: 1000, duration: 337, averageHR: opts.hr ? 145 : null })) : null,
      splits: opts.laps ? Array.from({ length: 8 }, () => ({ distance: 1000, duration: 337 })) : null,
    });
  }
}

const test30 = (id: string) => db.tables.academy_tests.push({ id: uid(), athlete_id: id, test_date: '2026-08-20', protocol: '30min', duration_sec: 1800, distance_m: 7143, excluded_reason: null, status: 'approved' });
const nights = (id: string, n: number) => {
  for (let i = 0; i < n; i += 1) db.tables.athlete_wellness.push({ athlete_id: id, date: day(-i), sleep_seconds: 26000 + (i % 5) * 600, resting_hr: 46 + (i % 5) });
};

function seed() {
  db = createMemoryDb({ schema: SCHEMA });
  db.tables.groups.push({ id: GROUP, name: 'Group B', coach_id: COACH_ID });
  const garmin = { garmin_auth: SECRET, garmin_last_sync_at: `${TODAY}T03:00:00Z` };
  // Full data: Garmin, a test, 90 days of runs with HR and laps, 31 nights, own plan, a device.
  athlete(FULL, 'Full Data', { ...garmin, notification_prefs: { morningReminder: { enabled: true, time: '06:00' } } });
  test30(FULL); runs(FULL, 90, { source: 'garmin', hr: true, laps: true }); nights(FULL, 31);
  db.tables.push_subscriptions.push({ id: uid(), athlete_id: FULL });
  db.tables.weekly_plans.push({ id: uid(), coach_id: COACH_ID, athlete_id: FULL, week_start_date: WEEK, parsed_workouts: { workouts: [EASY] }, status: 'pushed', created_at: '2026-10-10T10:00:00Z' });
  // Garmin syncs runs, the watch never worn at night.
  athlete(NOWELL, 'No Wellness', garmin);
  test30(NOWELL); runs(NOWELL, 90, { source: 'garmin', hr: true, laps: true });
  // Strava only, no test, no laps, no HR.
  athlete(STRAVA, 'Strava Only', { strava_auth: 'strava-secret', strava_last_sync_at: `${TODAY}T03:00:00Z` });
  runs(STRAVA, 20, { source: 'strava', hr: false, laps: false });
  // The club's group plan this week (the no-own-plan trainees read it).
  db.tables.weekly_plans.push({ id: uid(), coach_id: COACH_ID, athlete_id: null, week_start_date: WEEK, parsed_workouts: { workouts: [EASY] }, status: 'pushed', created_at: '2026-10-09T10:00:00Z' });
  // Not academy: never listed.
  athlete(RUNNER, 'Club Runner', { is_academy: false });
  athlete(ADMIN, 'Admin', { is_academy: false, role: 'admin' });
}

const admin = (extra: Record<string, unknown> = {}) =>
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: ADMIN, isStaff: true, isSuperUser: false, role: 'admin', roles: ['admin'], ...extra } });

beforeEach(() => {
  seed();
  admin();
});

const screen = (row: any, s: string, item: string) => row.screens.find((x: any) => x.screen === s && x.item === item);

describe('who may read it', () => {
  it('passes the auth denial straight through, reading nothing', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response('{}', { status: 401 }), caller: {} });
    expect((await get()).status).toBe(401);
    expect(db.log).toHaveLength(0);
  });

  it('is 403 for a coach (staff is not enough), reading nothing', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: uid(), isStaff: true, isSuperUser: false, role: 'academy_coach', roles: ['academy_coach'] } });
    expect((await get()).status).toBe(403);
    expect(db.log).toHaveLength(0);
  });

  it('is 403 under view-as, even for the super user, reading nothing', async () => {
    admin({ isSuperUser: true, viewingAsBy: 'ofer@club' });
    const res = await get();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('view_as_refused');
    expect(db.log).toHaveLength(0);
  });

  it('answers the super user without the admin role', async () => {
    admin({ role: 'runner', roles: ['runner'], isSuperUser: true });
    expect((await get()).status).toBe(200);
  });
});

describe('the check', () => {
  it('lists every academy member, writes nothing, and never returns a credential', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const text = await res.clone().text();
    const out = await res.json();
    expect(out.trainees.map((t: any) => t.name)).toEqual(['Full Data', 'No Wellness', 'Strava Only']);
    expect(db.log.filter(l => l.op !== 'select')).toEqual([]);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('strava-secret');
  });

  it('counts the data: providers, runs, tests, nights, plan, devices, reminder', async () => {
    const out = await (await get()).json();
    const [full, nowell, strava] = out.trainees;
    expect(full).toMatchObject({
      garmin: { linked: true, lastSyncAt: `${TODAY}T03:00:00Z` }, strava: { linked: false },
      runs42: { total: 42, withHr: 42, withLaps: 42, stravaOnly: 0, manual: 0 },
      test: { kind: 'ok', date: '2026-08-20', threshold: true },
      maxHr: { fromRuns: 178 },
      wellness30: { sleepNights: 30, rhrMornings: 30, latest: TODAY },
      planThisWeek: 'own', pushSubscriptions: 1,
      reminder: { enabled: true, time: '06:00', explicit: true },
    });
    expect(nowell).toMatchObject({ wellness30: { sleepNights: 0, rhrMornings: 0, latest: null }, planThisWeek: 'group', pushSubscriptions: 0 });
    expect(strava).toMatchObject({
      garmin: { linked: false }, strava: { linked: true },
      runs42: { total: 20, withHr: 0, withLaps: 0, stravaOnly: 20 },
      test: { kind: 'none', threshold: false }, maxHr: { fromRuns: null },
      // Off until TRAINEE_V2_FOR_ALL: nobody saved it.
      reminder: { enabled: false, explicit: false },
    });
  });

  it('names what each trainee will see', async () => {
    const out = await (await get()).json();
    const [full, nowell, strava] = out.trainees;
    expect(full.screens.filter((s: any) => s.state !== 'full')).toEqual([]);
    expect(screen(nowell, '1', 'sleep')).toMatchObject({ state: 'missing', code: 'neverWorn' });
    expect(screen(nowell, '8', 'rhr')).toMatchObject({ state: 'missing', code: 'neverWorn' });
    expect(screen(nowell, '9', 'reminder')).toMatchObject({ state: 'off', code: 'disabled' });
    expect(screen(strava, '1', 'card')).toMatchObject({ state: 'missing', code: 'noTest' });
    expect(screen(strava, '2', 'plannedLoad')).toMatchObject({ state: 'missing', code: 'noTest' });
    expect(screen(strava, '8', 'sleep')).toMatchObject({ state: 'missing', code: 'noGarmin' });
    expect(screen(strava, '4', 'watch')).toMatchObject({ state: 'missing', code: 'noWatch' });
    expect(screen(strava, '5', 'laps')).toMatchObject({ state: 'missing', code: 'stravaPending' });
    expect(screen(strava, '5', 'load')).toMatchObject({ state: 'missing', code: 'noHr' });
  });

  it('every verdict is the screens\' own: the same as reading today, load and body as the trainee', async () => {
    const out = await (await get()).json();
    for (const row of out.trainees) {
      callerFor.mockReturnValue({ athleteId: row.athleteId, isStaff: false, isSuperUser: false, role: 'runner' });
      const q = `athleteId=${row.athleteId}`;
      const home = await (await today.GET(new Request(`http://x/api/academy/today?${q}`))).json();
      const progress = await (await load.GET(new Request(`http://x/api/academy/load?${q}`))).json();
      const bodyScreen = await (await body.GET(new Request(`http://x/api/academy/body?${q}`))).json();
      expect(screen(row, '1', 'card')).toEqual(cardVerdict('1', home));
      expect(screen(row, '1', 'form')).toEqual(loadStatusVerdict('1', 'form', home.form, { hrBasis: home.form.basis === 'hr' }));
      expect(screen(row, '1', 'sleep')).toEqual(chipVerdict('sleep', home.body.sleep, home.body.missing.sleep));
      expect(screen(row, '1', 'rhr')).toEqual(chipVerdict('rhr', home.body.rhr, home.body.missing.rhr));
      expect(screen(row, '7', 'load')).toEqual(loadStatusVerdict('7', 'load', progress.status));
      expect(screen(row, '8', 'sleep')).toEqual(panelVerdict('sleep', bodyScreen.sleep));
      expect(screen(row, '8', 'rhr')).toEqual(panelVerdict('rhr', bodyScreen.rhr));
    }
  });

  it('?format=text is a plain Hebrew table', async () => {
    const res = await get('?format=text');
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    const text = await res.text();
    expect(text).toContain('מה כל מתאמן יראה');
    expect(text).toContain('Strava Only');
    expect(text).toContain('שינה ודופק מנוחה מגיעים רק מגרמין');
    expect(text).not.toContain(SECRET);
  });
});

describe('members who see no screen', () => {
  it('an invited trainee is one "not active" verdict, never a row of ✓', async () => {
    db.tables.athletes.find(a => a.id === NOWELL)!.status = 'invited';
    const out = await (await get()).json();
    const row = out.trainees.find((t: any) => t.athleteId === NOWELL);
    expect(row.screens).toEqual([expect.objectContaining({ screen: '*', item: 'access', state: 'missing', code: 'inactive' })]);
    const text = await (await get('?format=text')).text();
    expect(text).toContain('הגישה שלך לא פעילה');
  });

  it('runs the trainee\'s own open would price are priced, never "still computing"', async () => {
    // Migration 142 is in and empty: 90 runs with no stored load. A write-free screen read
    // would price 300 at most and call the rest "computing"; the check prices them all.
    SCHEMA.activity_loads = ['activity_id', 'athlete_id', 'activity_date', 'load', 'source', 'threshold_sec', 'basis_test_date', 'formula_version', 'computed_at'];
    seed();
    delete SCHEMA.activity_loads;
    const out = await (await get()).json();
    const full = out.trainees.find((t: any) => t.athleteId === FULL);
    expect(screen(full, '7', 'load')).toMatchObject({ code: 'ok' });
    expect(db.log.filter(l => l.op !== 'select')).toEqual([]);
    // The stored side is not even read: in memory, start to finish.
    expect(db.log.some(l => l.table === 'activity_loads')).toBe(false);
  });
});

describe('screen 5', () => {
  it('a run synced twice is judged by the copy screen 5 opens, not its twin', async () => {
    // Yesterday's Garmin run, and the same run again from Strava with no laps a minute later.
    const g = db.tables.athlete_activities.filter(a => a.athlete_id === FULL).sort((a, b) => a.start_time.localeCompare(b.start_time)).pop()!;
    db.tables.athlete_activities.push({ ...g, id: uid(), source: 'strava', laps: null, splits: null, start_time: g.start_time.replace('06:30', '06:31') });
    const out = await (await get()).json();
    const full = out.trainees.find((t: any) => t.athleteId === FULL);
    expect(screen(full, '5', 'laps')).toMatchObject({ state: 'full' });
    expect(screen(full, '5', 'load')).toMatchObject({ state: 'full' });
  });
});
