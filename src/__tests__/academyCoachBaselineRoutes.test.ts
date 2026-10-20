import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { BASELINE_PROTOCOL, thresholdFromRace } from '@/lib/academy/coach-baseline';
import { sessionGlance, fromLibrarySteps } from '@/lib/academy/book-steps';
import type { LibraryStep } from '@/lib/academy/library';

/**
 * The routes of the coach's baseline build (Ofer, 2026-10-20): the baseline in טופס התאמה,
 * the manual zones, the band's "מה זה אומר", and the whole group week for one trainee.
 */

const TRAINEE = uid();
const COACH = uid();
const MANAGER = uid();
const BAND = uid();

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

let caller: Record<string, unknown> = { athleteId: COACH, isStaff: true, isSuperUser: false, role: 'academy_coach' };
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => ({ denied: null, caller }),
}));
vi.mock('@/lib/academy/pairing-server', async (orig) => ({
  ...(await orig<typeof import('@/lib/academy/pairing-server')>()),
  mayCoach: async (c: { athleteId: string }, id: string) => id === TRAINEE && c.athleteId !== TRAINEE,
  requireTraineeAccess: async (_r: Request, id: string) => (id === TRAINEE && caller.athleteId !== TRAINEE
    ? { denied: null, caller, pair: null }
    : { denied: new Response('no', { status: 403 }), caller, pair: null }),
  requireAcademyManager: async () => (caller.athleteId === MANAGER
    ? { denied: null, caller }
    : { denied: new Response('no', { status: 403 }), caller }),
}));
// The decisions read embeds the coach's name, which the in-memory db does not draw: read the rows straight.
vi.mock('@/lib/academy/coach-tools-server', async (orig) => {
  const real = await orig<typeof import('@/lib/academy/coach-tools-server')>();
  return {
    ...real,
    loadDecisions: async (_s: unknown, ids: string[]) => ({
      stored: true,
      rows: db.tables.academy_coach_decisions.filter((r) => ids.includes(r.athlete_id as string)).map((r) => ({
        athleteId: r.athlete_id, kind: r.kind, action: r.action, basisTestDate: r.basis_test_date, weekStart: r.week_start,
        changes: r.changes, createdAt: r.created_at, reason: null,
      })),
    }),
  };
});

const SCHEMA: Record<string, string[]> = {
  athletes: ['id', 'name', 'academy_intake', 'academy_band_id', 'coach_id', 'is_academy', 'status', 'garmin_auth'],
  academy_bands: ['id', 'name', 'band_number', 'active', 'pace_profile', 'goal', 'updated_at'],
  academy_candidates: ['id', 'athlete_id', 'created_at'],
  academy_characterizations: ['candidate_id', 'goal_type', 'available_days'],
  academy_tests: ['id', 'athlete_id', 'test_date', 'protocol', 'duration_sec', 'distance_m', 'excluded_reason', 'status', 'notes', 'author_id', 'approved_by', 'approved_at'],
  academy_coach_decisions: ['id', 'athlete_id', 'coach_id', 'kind', 'action', 'basis_test_date', 'week_start', 'changes', 'evidence', 'created_at'],
};

const { COACH_ID } = await import('@/lib/constants');
const setup = await import('@/app/api/academy/trainee-setup/route');
const zones = await import('@/app/api/academy/zones/route');
const bands = await import('@/app/api/academy/bands/route');

const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://x${url}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });

beforeEach(() => {
  db = createMemoryDb({ schema: SCHEMA, defaults: { academy_coach_decisions: () => ({ id: uid(), created_at: new Date().toISOString() }) } } as never);
  caller = { athleteId: COACH, isStaff: true, isSuperUser: false, role: 'academy_coach' };
  db.tables.athletes.push({
    id: TRAINEE, name: 'Roni Gur', coach_id: COACH_ID, is_academy: true, status: 'active', garmin_auth: null, academy_band_id: BAND,
    academy_intake: { focus: 'רק תכנית אימון און ליין ומעקב', sheet_results: { '5k': 1200, '10k': 2520, hm: 5520, m: 12600 } },
  });
  db.tables.academy_bands.push({ id: BAND, name: 'דבוקה 4', band_number: 4, active: true, goal: 'מרתון חזק עם רצון לסאב 3', pace_profile: { marathonGoal: 'SUB 3:00' } });
});

describe('טופס התאמה — the baseline', () => {
  it('is listed as missing until set, and prefilled from the file', async () => {
    const res = await setup.GET(req(`/api/academy/trainee-setup?athleteId=${TRAINEE}`));
    const body = await res.json();
    expect(body.missing).toContain('baseline');
    expect(body.suggestion).toMatchObject({ pick: '10k', sec: 2520 });
    expect(body.bands[0].description).toBeNull();
  });

  it('saves one row, protocol coach_baseline, as its 30-minute equivalent; a second save replaces it', async () => {
    let res = await setup.PUT(req('/api/academy/trainee-setup', 'PUT', { athleteId: TRAINEE, baseline: { distance: '10k', sec: 2520, origin: 'sheet' } }));
    expect(res.status).toBe(200);
    res = await setup.PUT(req('/api/academy/trainee-setup', 'PUT', { athleteId: TRAINEE, baseline: { distance: '5k', sec: 1200, origin: 'race' } }));
    expect(res.status).toBe(200);
    const rows = db.tables.academy_tests.filter((r) => r.athlete_id === TRAINEE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ protocol: BASELINE_PROTOCOL, duration_sec: 1800, status: 'approved', author_id: COACH });
    expect(Math.round(1800 / ((rows[0].distance_m as number) / 1000))).toBe(thresholdFromRace(5, 1200));
    const body = await (await setup.GET(req(`/api/academy/trainee-setup?athleteId=${TRAINEE}`))).json();
    expect(body.missing).not.toContain('baseline');
    expect(body.baseline.source).toMatchObject({ distance: '5k', sec: 1200, origin: 'race' });
  });

  it('refuses an impossible result, and the trainee themself', async () => {
    expect((await setup.PUT(req('/api/academy/trainee-setup', 'PUT', { athleteId: TRAINEE, baseline: { distance: '10k', sec: 600 } }))).status).toBe(400);
    caller = { athleteId: TRAINEE, isStaff: false, isSuperUser: false, role: 'runner' };
    expect((await setup.PUT(req('/api/academy/trainee-setup', 'PUT', { athleteId: TRAINEE, baseline: { distance: '10k', sec: 2520 } }))).status).toBe(403);
  });

  it('is not needed once there is an approved 30-minute test', async () => {
    db.tables.academy_tests.push({ id: uid(), athlete_id: TRAINEE, test_date: '2026-09-19', protocol: '30min', duration_sec: 1800, distance_m: 6500, excluded_reason: null, status: 'approved' });
    const body = await (await setup.GET(req(`/api/academy/trainee-setup?athleteId=${TRAINEE}`))).json();
    expect(body.tested).toBe(true);
    expect(body.missing).not.toContain('baseline');
  });
});

describe('/api/academy/zones', () => {
  beforeEach(() => {
    db.tables.academy_tests.push({ id: uid(), athlete_id: TRAINEE, test_date: '2026-10-20', protocol: BASELINE_PROTOCOL, duration_sec: 1800, distance_m: 7287, excluded_reason: null, status: 'approved' });
  });

  it('suggests every zone from the baseline, then keeps a manual one, then resets it', async () => {
    let body = await (await zones.GET(req(`/api/academy/zones?athleteId=${TRAINEE}`))).json();
    expect(body.basis).toBe('coach');
    expect(body.zones.map((z: { zone: string }) => z.zone)).toEqual(['easy', 'marathon_pace', 'tempo', 'threshold', 'interval', 'sprint']);
    expect(body.zones.every((z: { suggested: number; set: null }) => z.suggested > 0 && z.set === null)).toBe(true);

    expect((await zones.PUT(req('/api/academy/zones', 'PUT', { athleteId: TRAINEE, zones: { tempo: 257 } }))).status).toBe(200);
    body = await (await zones.GET(req(`/api/academy/zones?athleteId=${TRAINEE}`))).json();
    expect(body.zones.find((z: { zone: string }) => z.zone === 'tempo').set).toBe(257);

    await new Promise((r) => setTimeout(r, 5));
    expect((await zones.PUT(req('/api/academy/zones', 'PUT', { athleteId: TRAINEE, zones: {} }))).status).toBe(200);
    body = await (await zones.GET(req(`/api/academy/zones?athleteId=${TRAINEE}`))).json();
    expect(body.zones.find((z: { zone: string }) => z.zone === 'tempo').set).toBeNull();
  });

  it('a new approved test clears them and says so', async () => {
    await zones.PUT(req('/api/academy/zones', 'PUT', { athleteId: TRAINEE, zones: { tempo: 257 } }));
    db.tables.academy_tests.push({ id: uid(), athlete_id: TRAINEE, test_date: '2026-10-25', protocol: '30min', duration_sec: 1800, distance_m: 7400, excluded_reason: null, status: 'approved' });
    const body = await (await zones.GET(req(`/api/academy/zones?athleteId=${TRAINEE}`))).json();
    expect(body.basis).toBe('test');
    expect(body.zones.find((z: { zone: string }) => z.zone === 'tempo').set).toBeNull();
    expect(body.lapsed).toMatchObject({ since: '2026-10-25', zones: { tempo: 257 } });
  });

  it('is closed to the trainee and to strangers', async () => {
    caller = { athleteId: TRAINEE, isStaff: false, isSuperUser: false, role: 'runner' };
    expect((await zones.GET(req(`/api/academy/zones?athleteId=${TRAINEE}`))).status).toBe(403);
    caller = { athleteId: COACH, isStaff: true, isSuperUser: false, role: 'academy_coach' };
    expect((await zones.GET(req(`/api/academy/zones?athleteId=${uid()}`))).status).toBe(403);
  });
});

describe('PATCH /api/academy/bands — "מה זה אומר"', () => {
  it('the manager sets it, merged into pace_profile; clearing removes the key only', async () => {
    caller = { athleteId: MANAGER, isStaff: true, isSuperUser: false, role: 'academy_coach', roles: ['academy_manager'] };
    let res = await bands.PATCH(req('/api/academy/bands', 'PATCH', { bandId: BAND, description: '  מרתון חזק עם רצון לסאב 3  ' }));
    expect(res.status).toBe(200);
    expect(db.tables.academy_bands[0].pace_profile).toEqual({ marathonGoal: 'SUB 3:00', description: 'מרתון חזק עם רצון לסאב 3' });
    res = await bands.PATCH(req('/api/academy/bands', 'PATCH', { bandId: BAND, description: null }));
    expect(res.status).toBe(200);
    expect(db.tables.academy_bands[0].pace_profile).toEqual({ marathonGoal: 'SUB 3:00' });
  });
  it('a coach cannot', async () => {
    expect((await bands.PATCH(req('/api/academy/bands', 'PATCH', { bandId: BAND, description: 'x' }))).status).toBe(403);
  });
});

describe('the book entry at a glance', () => {
  const STEPS: LibraryStep[] = [
    { type: 'warmup', durationType: 'time', durationValue: 900, intensity: { fastPct: 80, slowPct: 72 } },
    {
      type: 'interval', repeatCount: 5, durationType: 'distance', durationValue: 0,
      repeatSteps: [
        { type: 'interval', durationType: 'distance', durationValue: 1000, intensity: { fastPct: 102, slowPct: 98 } },
        { type: 'rest', durationType: 'time', durationValue: 120 },
      ],
    },
    { type: 'cooldown', durationType: 'time', durationValue: 600, intensity: { fastPct: 80, slowPct: 72 } },
  ] as never;

  it('totals, warm-up, the main set at the trainee\'s pace, recoveries, cool-down', () => {
    const model = fromLibrarySteps(STEPS)!;
    expect(model).not.toBeNull();
    const g = sessionGlance(model, 247);
    expect(g.warmup?.durationSec).toBe(900);
    expect(g.cooldown?.durationSec).toBe(600);
    expect(g.main).toMatchObject({ count: 5, work: { measure: 'distance', value: 1000 }, paceSec: 247 });
    expect(g.recovery).toMatchObject({ length: { measure: 'time', value: 120 }, count: 4 });
    expect(g.total.durationSec).toBeGreaterThan(900 + 600 + 5 * 247);
    expect(g.total.distanceM).toBeGreaterThan(5000);
  });

  it('a manual zone moves the main set\'s pace; editing the draft never touches the library row', () => {
    const row = JSON.parse(JSON.stringify(STEPS));
    const model = fromLibrarySteps(row)!;
    const edited = model.map((s) => (s.kind === 'reps' ? { ...s, count: 6 } : s));
    expect(sessionGlance(edited, 247, { zones: { threshold: 240 } }).main).toMatchObject({ count: 6, paceSec: 240 });
    expect(row).toEqual(STEPS);
  });
});
