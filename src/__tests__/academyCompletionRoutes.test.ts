import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';

/**
 * The routes behind the existing-trainees screens (mockup academy-existing-trainees):
 *
 *   GET  /api/academy/completion           phone 1, who is missing what
 *   POST /api/academy/completion/request   "לבקש מכולם", once
 *   GET  /api/academy/tests/watch          phone 3, the test-like runs
 *   GET  /api/academy/tests/entry          phone 4, the trainee's card state
 *   PUT  /api/academy/goal                 the goal row (migration 144)
 *
 * What only the routes can get wrong: the scope (a coach sees and asks only their own
 * trainees, a trainee only themselves), the idempotency of the request (the inbox row IS the
 * record), and the pre-migration behaviour (144 missing reads as no goal and refuses a save).
 */

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-11T09:00:00+03:00'));
afterAll(() => { vi.useRealTimers(); });

const MANAGER = uid();
const COACH = uid();
const OTHER_COACH = uid();
const SHAHAR = uid();
const YOAV = uid();
const NOA = uid();
const THEIRS = uid();
const BAND4 = uid();

type Caller = { athleteId: string; isStaff: boolean; isSuperUser: boolean; role: string; viewingAsBy?: string };
let caller: Caller;
const asManager = () => { caller = { athleteId: MANAGER, isStaff: true, isSuperUser: false, role: 'admin' }; };
const asCoach = (id = COACH) => { caller = { athleteId: id, isStaff: true, isSuperUser: false, role: 'academy_coach' }; };
const asTrainee = (id: string) => { caller = { athleteId: id, isStaff: false, isSuperUser: false, role: 'runner' }; };

vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => ({ denied: null, caller }),
  requireStaffCaller: async () => (caller.isStaff
    ? { denied: null, caller }
    : { denied: new Response(JSON.stringify({ error: 'Staff access required' }), { status: 403 }), caller }),
}));

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('@/lib/stream/server', () => ({ getStreamServerClient: () => { throw new Error('no Stream in tests'); } }));

// The pairing gates over the fake roster: the legacy `academy_coach_id` is the pair.
vi.mock('@/lib/academy/pairing-server', () => ({
  isAcademyManager: (c: Caller) => c.role === 'admin',
  visibleTraineeIds: async (c: Caller) => (c.role === 'admin'
    ? null
    : new Set(db.tables.athletes.filter(a => a.academy_coach_id === c.athleteId).map(a => a.id))),
  mayCoach: async (c: Caller, id: string) => c.athleteId === id || c.role === 'admin'
    || (c.isStaff && db.tables.athletes.some(a => a.id === id && a.academy_coach_id === c.athleteId)),
}));

const notified: Array<{ athleteId: string; title: string; body: string; url: string }> = [];
vi.mock('@/lib/push', () => ({
  notifyAthlete: async (o: { athleteId: string; kind: string; url: string; copy: (l: 'he') => { title: string; body: string } }) => {
    const { title, body } = o.copy('he');
    notified.push({ athleteId: o.athleteId, title, body, url: o.url });
    // What the real one persists: the inbox row, which is also the request's record.
    db.tables.scheduled_notifications.push({
      id: uid(), kind: o.kind, audience_id: o.athleteId, audience_type: 'athlete', title_he: title, body_he: body,
      status: 'sent', last_sent_at: new Date().toISOString(), created_at: new Date().toISOString(),
    });
    return { subscriptions: 1, delivered: 1 };
  },
}));

const completion = await import('@/app/api/academy/completion/route');
const request = await import('@/app/api/academy/completion/request/route');
const watch = await import('@/app/api/academy/tests/watch/route');
const entry = await import('@/app/api/academy/tests/entry/route');
const goal = await import('@/app/api/academy/goal/route');

const SCHEMA: Record<string, string[]> = {
  athletes: ['id', 'coach_id', 'name', 'gender', 'is_academy', 'approved', 'status', 'academy_coach_id', 'academy_band_id', 'avatar_url', 'academy_joined_on'],
  academy_bands: ['id', 'band_number', 'name', 'goal', 'pace_profile'],
  academy_tests: ['id', 'athlete_id', 'test_date', 'protocol', 'duration_sec', 'distance_m', 'avg_hr', 'activity_id', 'excluded_reason', 'status', 'submitted_at'],
  athlete_activities: ['id', 'athlete_id', 'start_time', 'activity_name', 'activity_type', 'source', 'distance', 'duration', 'moving_duration', 'average_hr', 'laps'],
  scheduled_notifications: ['id', 'kind', 'audience_id', 'audience_type', 'title_he', 'body_he', 'status', 'last_sent_at', 'created_at'],
  academy_candidates: ['id', 'athlete_id', 'name', 'source', 'accepted_at'],
  academy_characterizations: ['candidate_id', 'goal_type', 'target_race', 'target_race_date'],
  academy_goals: ['athlete_id', 'goal_type', 'target_race', 'target_race_date', 'goal_time_sec', 'updated_by', 'updated_at'],
};

function seed({ goals = true }: { goals?: boolean } = {}) {
  const schema = { ...SCHEMA };
  if (!goals) delete schema.academy_goals;
  db = createMemoryDb({ schema, unique: { academy_goals: [['athlete_id']] } });
  db.tables.academy_bands.push({ id: BAND4, band_number: 4, name: 'דבוקה 4', goal: null, pace_profile: {} });
  const person = (id: string, name: string, over: Record<string, unknown> = {}) => db.tables.athletes.push({
    id, coach_id: COACH_ID, name, gender: 'male', is_academy: true, approved: true, status: 'active',
    academy_coach_id: COACH, academy_band_id: BAND4, avatar_url: null, ...over,
  });
  person(MANAGER, 'Manager', { is_academy: false, academy_coach_id: null });
  person(COACH, 'Sahar Azar', { is_academy: false, academy_coach_id: null });
  person(SHAHAR, 'Shahar Glazner');
  person(YOAV, 'Yoav Cohen', { academy_band_id: null });
  person(NOA, 'Noa Barak');
  person(THEIRS, 'Other Trainee', { academy_coach_id: OTHER_COACH });
  // Noa's own submission, waiting; the other coach's trainee is ready.
  db.tables.academy_tests.push(
    { id: uid(), athlete_id: NOA, test_date: '2026-10-09', protocol: '30min', duration_sec: 1800, distance_m: 7000, avg_hr: null, activity_id: null, excluded_reason: null, status: 'pending', submitted_at: '2026-10-09T18:00:00Z' },
    { id: uid(), athlete_id: THEIRS, test_date: '2026-09-20', protocol: '30min', duration_sec: 1800, distance_m: 6500, avg_hr: null, activity_id: null, excluded_reason: null, status: 'approved', submitted_at: null },
  );
}

beforeEach(() => { notified.length = 0; seed(); });

const req = (path: string, init?: RequestInit) => new Request(`http://x${path}`, init);
const json = (body: unknown) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('GET /api/academy/completion', () => {
  it('the manager sees every trainee, with what each is missing', async () => {
    asManager();
    const res = await completion.GET(req('/api/academy/completion'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe('academy');
    expect(body.canAssign).toBe(true);
    expect(body.summary).toEqual({ total: 4, ready: 1, missing: 3, needTest: 2, pending: 1 });
    const byName = Object.fromEntries(body.rows.map((r: any) => [r.name, r]));
    expect(byName['Yoav Cohen'].missing).toEqual(['test', 'band']);
    expect(byName['Noa Barak']).toMatchObject({ test: 'pending', action: 'approve' });
    expect(byName['Noa Barak'].pendingTest).toMatchObject({ date: '2026-10-09', source: 'typed', paceSec: 257 });
    expect(byName['Shahar Glazner'].coachNames).toEqual(['Sahar Azar']);
  });

  it('a coach sees only their own trainees, and may not assign', async () => {
    asCoach();
    const body = await (await completion.GET(req('/api/academy/completion'))).json();
    expect(body.scope).toBe('coach');
    expect(body.canAssign).toBe(false);
    expect(body.rows.map((r: any) => r.athleteId).sort()).toEqual([SHAHAR, YOAV, NOA].sort());
  });

  it('a trainee is refused', async () => {
    asTrainee(SHAHAR);
    expect((await completion.GET(req('/api/academy/completion'))).status).toBe(403);
  });

  it('before migration 144 the goal reads from the characterization, and says it cannot be saved', async () => {
    seed({ goals: false });
    db.tables.academy_candidates.push({ id: 'cand', athlete_id: SHAHAR });
    db.tables.academy_characterizations.push({ candidate_id: 'cand', goal_type: 'full', target_race: 'טבריה', target_race_date: '2027-01-08' });
    asManager();
    const body = await (await completion.GET(req('/api/academy/completion'))).json();
    expect(body.goalsStored).toBe(false);
    const shahar = body.rows.find((r: any) => r.athleteId === SHAHAR);
    expect(shahar.hasGoal).toBe(true);
    expect(shahar.goal.targetRace).toBe('טבריה');
  });
});

describe('POST /api/academy/completion/request', () => {
  it('asks everyone in scope without a test, once', async () => {
    asCoach();
    const first = await (await request.POST(req('/api/academy/completion/request', { method: 'POST' }))).json();
    // Shahar and Yoav have no test; Noa's waits for approval and is not asked.
    expect(first).toMatchObject({ asked: 2, already: 0 });
    expect(notified.map(n => n.athleteId).sort()).toEqual([SHAHAR, YOAV].sort());
    expect(notified[0].title).toBe('🎯 חסר לנו הטסט האחרון שלך');
    expect(notified[0].body).toMatch(/^Sahar מבקש: /);
    expect(notified[0].url).toBe('/dashboard/academy?test=entry');

    const second = await (await request.POST(req('/api/academy/completion/request', { method: 'POST' }))).json();
    expect(second).toMatchObject({ asked: 0, already: 2 });
    expect(notified).toHaveLength(2);
  });

  it('two taps at once send once: the second reads the first\'s rows', async () => {
    asCoach();
    const [a, b] = await Promise.all([
      request.POST(req('/api/academy/completion/request', { method: 'POST' })).then(r => r.json()),
      request.POST(req('/api/academy/completion/request', { method: 'POST' })).then(r => r.json()),
    ]);
    expect(a.asked + b.asked).toBe(2);
    expect(notified).toHaveLength(2);
    expect(db.tables.scheduled_notifications.filter(n => n.audience_id === SHAHAR)).toHaveLength(1);
  });

  it('a trainee whose 2000 m waits for approval is not asked again', async () => {
    db.tables.academy_tests.push({ id: uid(), athlete_id: SHAHAR, test_date: '2026-10-10', protocol: '2000m', duration_sec: 470, distance_m: 2000, avg_hr: null, activity_id: null, excluded_reason: null, status: 'pending', submitted_at: '2026-10-10T18:00:00Z' });
    asCoach();
    const first = await (await request.POST(req('/api/academy/completion/request', { method: 'POST' }))).json();
    expect(first).toMatchObject({ asked: 1 });
    expect(notified.map(n => n.athleteId)).toEqual([YOAV]);
  });

  it('a trainee who joined this month is skipped — unless they are an existing trainee moved in', async () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const a of db.tables.athletes) if (a.id === SHAHAR || a.id === YOAV) a.academy_joined_on = today;
    (db.tables.academy_candidates ||= []).push({ id: uid(), name: 'Shahar', athlete_id: SHAHAR, source: 'existing', accepted_at: today });
    asCoach();
    const first = await (await request.POST(req('/api/academy/completion/request', { method: 'POST' }))).json();
    expect(first).toMatchObject({ asked: 1 });
    expect(notified.map(n => n.athleteId)).toEqual([SHAHAR]);
  });

  it('a coach never reaches another coach\'s trainee', async () => {
    db.tables.academy_tests = db.tables.academy_tests.filter(t => t.athlete_id !== THEIRS);
    asCoach();
    await request.POST(req('/api/academy/completion/request', { method: 'POST' }));
    expect(notified.map(n => n.athleteId)).not.toContain(THEIRS);
  });
});

describe('GET /api/academy/tests/watch', () => {
  const named = (athleteId: string) => db.tables.athlete_activities.push({
    id: uid(), athlete_id: athleteId, start_time: '2026-09-14T07:00:00+00:00', activity_name: 'טסט 30 דק׳', activity_type: 'running',
    source: 'garmin', distance: 7120, duration: 1800, moving_duration: 1800, average_hr: 171, laps: [],
  });

  it('the coach finds the trainee\'s named test, and what is already on record', async () => {
    named(SHAHAR);
    asCoach();
    const body = await (await watch.GET(req(`/api/academy/tests/watch?athleteId=${SHAHAR}`))).json();
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({ date: '2026-09-14', protocol: '30min', distanceM: 7120, avgHr: 171 });
    expect(body.windowDays).toBe(183);
  });

  it('another coach, or another trainee, gets the same 404 as a stranger', async () => {
    named(SHAHAR);
    asCoach(OTHER_COACH);
    expect((await watch.GET(req(`/api/academy/tests/watch?athleteId=${SHAHAR}`))).status).toBe(404);
    asTrainee(YOAV);
    expect((await watch.GET(req(`/api/academy/tests/watch?athleteId=${SHAHAR}`))).status).toBe(404);
    asTrainee(SHAHAR);
    expect((await watch.GET(req(`/api/academy/tests/watch?athleteId=${SHAHAR}`))).status).toBe(200);
  });
});

describe('GET /api/academy/tests/entry', () => {
  it('missing → pending → gone, read live from the tests', async () => {
    asTrainee(SHAHAR);
    const before = await (await entry.GET(req(`/api/academy/tests/entry?athleteId=${SHAHAR}`))).json();
    expect(before).toMatchObject({ isMember: true, show: 'missing', test: { kind: 'none' }, coach: { name: 'Sahar Azar' } });

    db.tables.academy_tests.push({ id: uid(), athlete_id: SHAHAR, test_date: '2026-09-14', protocol: '30min', duration_sec: 1800, distance_m: 7120, avg_hr: null, activity_id: null, excluded_reason: null, status: 'pending', submitted_at: null });
    expect((await (await entry.GET(req(`/api/academy/tests/entry?athleteId=${SHAHAR}`))).json()).show).toBe('pending');

    db.tables.academy_tests[db.tables.academy_tests.length - 1].status = 'approved';
    expect((await (await entry.GET(req(`/api/academy/tests/entry?athleteId=${SHAHAR}`))).json()).show).toBe('none');
  });

  it('a 2000 m sent from the card reads "ממתין לאישור" too, and the list says "לאשר" on it', async () => {
    db.tables.academy_tests.push({ id: uid(), athlete_id: SHAHAR, test_date: '2026-10-10', protocol: '2000m', duration_sec: 470, distance_m: 2000, avg_hr: null, activity_id: null, excluded_reason: null, status: 'pending', submitted_at: '2026-10-10T18:00:00Z' });
    asTrainee(SHAHAR);
    const card = await (await entry.GET(req(`/api/academy/tests/entry?athleteId=${SHAHAR}`))).json();
    expect(card).toMatchObject({ show: 'pending', test: { kind: 'pending', date: '2026-10-10', protocol: '2000m' } });
    asCoach();
    const row = (await (await completion.GET(req('/api/academy/completion'))).json()).rows.find((r: any) => r.athleteId === SHAHAR);
    expect(row).toMatchObject({ test: 'pending', action: 'approve', pendingTest: { protocol: '2000m', status: 'pending' } });
  });

  it('nobody else\'s card', async () => {
    asTrainee(YOAV);
    expect((await entry.GET(req(`/api/academy/tests/entry?athleteId=${SHAHAR}`))).status).toBe(404);
  });
});

describe('PUT /api/academy/goal', () => {
  it('the trainee sets their own goal; it reads back on the list', async () => {
    asTrainee(SHAHAR);
    const res = await goal.PUT(req('/api/academy/goal', json({ athleteId: SHAHAR, goalType: 'full', targetRace: 'טבריה', targetRaceDate: '2027-01-08', goalTimeSec: 11700 })));
    expect(res.status).toBe(200);
    expect(db.tables.academy_goals).toEqual([expect.objectContaining({ athlete_id: SHAHAR, goal_time_sec: 11700, updated_by: SHAHAR })]);
    asManager();
    const body = await (await completion.GET(req('/api/academy/completion'))).json();
    expect(body.rows.find((r: any) => r.athleteId === SHAHAR).goal).toMatchObject({ goalType: 'full', targetRace: 'טבריה', targetRaceDate: '2027-01-08', goalTimeSec: 11700 });
  });

  it('not somebody else\'s; an unreadable field is a 400; before 144 a 503', async () => {
    asTrainee(YOAV);
    expect((await goal.PUT(req('/api/academy/goal', json({ athleteId: SHAHAR, goalType: 'full' })))).status).toBe(404);
    asCoach();
    expect((await goal.PUT(req('/api/academy/goal', json({ athleteId: SHAHAR, targetRaceDate: 'soon' })))).status).toBe(400);
    seed({ goals: false });
    asCoach();
    const res = await goal.PUT(req('/api/academy/goal', json({ athleteId: SHAHAR, goalType: 'full' })));
    expect(res.status).toBe(503);
    expect((await res.json()).tableMissing).toBe(true);
  });
});
