import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';

/**
 * Option C (owner decision 2026-11-22): the PWA's plan routes keep writing weekly_plans as
 * before, and every SENT write is also recorded as a plan-builder version, so the builder's
 * history is complete. Drafts are not recorded; a trainee write never touches the group stream.
 */
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('next/server', async (orig) => ({ ...(await orig<any>()), after: () => {} }));
vi.mock('@/lib/plans/cache', () => ({ revalidateWeeklyPlans: () => {} }));
vi.mock('@/lib/week-setup/server', () => ({ logWeek: async () => {}, tellWeekAdmins: async () => {} }));
vi.mock('@/lib/ai/parser', () => ({ parseWorkoutPlan: vi.fn(), EmptyParseError: class extends Error {} }));
vi.mock('@/lib/academy/pairing-server', async (orig) => ({ ...(await orig<object>()), academyTraineesNotYours: async () => [] }));
vi.mock('@/lib/auth-session', async (orig) => ({
  ...(await orig<object>()),
  requireSession: async () => ({ ok: true, user: { athleteId: 'staff1', role: 'admin', roles: ['admin'], isStaff: true, isSuperUser: true, email: 's', name: 'S' } }),
}));
const plans = await import('@/app/api/plans/route');
const { recordLegacyPlanWrite } = await import('@/lib/plan-builder/server');

const W = '2026-11-22';
const MAYA = '11111111-1111-4111-8111-111111111111';
const wk = (name: string) => ({ workouts: [{ dayOfWeek: 1, name, steps: [] }] });
const VERSION_COLS = ['id', 'week_start', 'athlete_id', 'plan_id', 'version', 'body', 'source', 'state', 'publish_at', 'publish_opts', 'published_at', 'published_by', 'created_by', 'created_at'];

function fresh(withAthleteCol = true) {
  db = createMemoryDb({
    schema: {
      weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'original_input', 'parsed_workouts', 'status', 'created_at'],
      weekly_plan_versions: withAthleteCol ? VERSION_COLS : VERSION_COLS.filter((c) => c !== 'athlete_id'),
    },
    defaults: { weekly_plans: () => ({ id: uid() }), weekly_plan_versions: () => ({ id: uid(), created_at: new Date().toISOString() }) },
  });
}
const versions = (who: string | null) => (db.tables.weekly_plan_versions as any[]).filter((v) => (v.athlete_id ?? null) === who);
const post = (b: Record<string, unknown>) => plans.POST(new Request('http://x/api/plans', { method: 'POST', body: JSON.stringify({ coach_id: COACH_ID, week_start_date: W, original_input: '', ...b }) }) as never);
const put = (b: Record<string, unknown>) => plans.PUT(new Request('http://x/api/plans', { method: 'PUT', body: JSON.stringify(b) }) as never);

beforeEach(() => fresh());

describe('POST/PUT /api/plans record a builder version', () => {
  it('a published group save is recorded as the group week\'s published version', async () => {
    const r = await post({ parsed_workouts: wk('club'), status: 'published' });
    expect(r.status).toBe(201);
    const plan = db.tables.weekly_plans[0] as any;
    expect(versions(null)).toHaveLength(1);
    expect(versions(null)[0]).toMatchObject({ state: 'published', plan_id: plan.id, version: 1, source: { kind: 'pwa' }, published_by: 'staff1' });
    expect(versions(null)[0].body.workouts[0].name).toBe('club');
  });

  it('a draft save is NOT recorded (it must not run over a builder draft)', async () => {
    await post({ parsed_workouts: wk('club'), status: 'draft' });
    expect(db.tables.weekly_plan_versions).toEqual([]);
  });

  it('a trainee save lands in the trainee stream only', async () => {
    await post({ parsed_workouts: wk('maya'), status: 'published', athlete_id: MAYA });
    expect(versions(MAYA)).toHaveLength(1);
    expect(versions(null)).toEqual([]);
  });

  it('PUT draft → published records it then; a status-only PUT with the same workouts adds no version', async () => {
    await post({ parsed_workouts: wk('club'), status: 'draft' });
    const id = (db.tables.weekly_plans[0] as any).id;
    await put({ plan_id: id, status: 'published' });
    expect(versions(null)).toHaveLength(1);
    await put({ plan_id: id, status: 'pushed' });
    expect(versions(null)).toHaveLength(1);
    await put({ plan_id: id, parsed_workouts: wk('club2') });
    expect(versions(null).map((v) => v.state).sort()).toEqual(['published', 'superseded']);
  });

  it('a newer PWA save supersedes the builder\'s published version and cancels a pending schedule', async () => {
    db.tables.weekly_plan_versions.push(
      { id: 'v1', week_start: W, athlete_id: null, version: 1, body: wk('builder'), state: 'published' },
      { id: 'v2', week_start: W, athlete_id: null, version: 2, body: wk('later'), state: 'scheduled', publish_at: '2026-11-23T18:00:00Z' },
    );
    await post({ parsed_workouts: wk('pwa'), status: 'published' });
    const byId = Object.fromEntries((db.tables.weekly_plan_versions as any[]).map((v) => [v.id, v]));
    expect(byId.v1.state).toBe('superseded');
    expect(byId.v2).toMatchObject({ state: 'draft', publish_at: null });
    expect(versions(null).find((v) => v.state === 'published')).toMatchObject({ version: 3 });
  });
});

describe('recordLegacyPlanWrite', () => {
  it('a grouped row is recorded from group1 (the same reading copyLastWeek uses)', async () => {
    await recordLegacyPlanWrite(db.client as any, { weekStart: W, parsed: { group1: wk('g1'), group2: wk('g2') }, status: 'pushed', planId: 'p1', kind: 'reimport' });
    expect(versions(null)[0].body.workouts[0].name).toBe('g1');
  });

  it('before migration 198 the group record still works; a trainee record is skipped; neither throws', async () => {
    fresh(false);
    await recordLegacyPlanWrite(db.client as any, { weekStart: W, parsed: wk('club'), status: 'published', planId: 'p1', kind: 'pwa' });
    await recordLegacyPlanWrite(db.client as any, { weekStart: W, athleteId: MAYA, parsed: wk('maya'), status: 'published', planId: 'p2', kind: 'pwa' });
    expect(db.tables.weekly_plan_versions).toHaveLength(1);
    expect((db.tables.weekly_plan_versions[0] as any).body.workouts[0].name).toBe('club');
  });

  it('a failing versions table never fails the caller', async () => {
    db = createMemoryDb({ schema: { weekly_plans: ['id'] } });
    await expect(recordLegacyPlanWrite(db.client as any, { weekStart: W, parsed: wk('x'), status: 'published', planId: 'p', kind: 'pwa' })).resolves.toBeUndefined();
  });
});
