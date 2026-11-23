import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Plan-builder per-athlete (academy trainee) weeks — migration 198, owner decision 2026-11-22.
 * The builder is the ONLY plan writer; the group stream (athlete_id NULL) and each trainee's
 * stream must never cross. One test per query site, against an in-memory table store.
 */

const pushed: string[] = [];
const notified: Array<{ athleteId: string; kind: string }> = [];
vi.mock('@/lib/garmin/push-week', () => ({ pushWeekToAthlete: vi.fn(async (o: any) => { pushed.push(`${o.athlete.id}:${o.paceTarget}`); return { status: 'success' }; }) }));
vi.mock('@/lib/academy/settings-server', () => ({ loadAcademySettings: vi.fn(async () => ({ paceAlerts: true })) }));
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn(async (o: any) => { notified.push({ athleteId: o.athleteId, kind: o.kind }); return {}; }) }));
vi.mock('@/lib/notifications/routing', () => ({ recipientsForKind: vi.fn(async () => ['staff1']) }));
vi.mock('@/lib/plans/cache', () => ({ revalidateWeeklyPlans: vi.fn() }));
vi.mock('@/lib/ai/parser', () => ({ parseWorkoutPlan: vi.fn(), EmptyParseError: class extends Error {} }));

let access: { denied: Response | null; caller: any; pair?: any };
const traineeAccess = vi.fn(async () => ({ pair: { isAcademy: true }, ...access }));
vi.mock('@/lib/academy/pairing-server', () => ({ requireTraineeAccess: (...a: unknown[]) => (traineeAccess as any)(...a) }));
let staffCaller: { denied: Response | null; caller: any };
vi.mock('@/lib/auth/self-or-staff', () => ({ requireStaffCaller: async () => staffCaller }));

type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let noAthleteCol: boolean;
let seq = 0;
const VERSIONED = ['weekly_plan_versions', 'plan_edit_locks'];

/** A tiny PostgREST: eq / is / in / lte / not-in / order / limit / single / maybeSingle over arrays. */
function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  const cols: string[] = [];
  let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  let payload: Row | null = null;
  let order: { c: string; asc: boolean } | null = null;
  let limit: number | null = null;
  const touch = (c: string) => cols.push(c);
  const q: any = {
    select: () => q,
    eq: (c: string, v: unknown) => { touch(c); filters.push((r) => r[c] === v); return q; },
    is: (c: string, v: null) => { touch(c); filters.push((r) => (r[c] ?? null) === v); return q; },
    in: (c: string, v: unknown[]) => { touch(c); filters.push((r) => v.includes(r[c])); return q; },
    lte: (c: string, v: string) => { touch(c); filters.push((r) => r[c] != null && r[c] <= v); return q; },
    not: (c: string, _o: string, v: string) => { const s = v.replace(/[()]/g, '').split(','); filters.push((r) => !s.includes(r[c])); return q; },
    order: (c: string, o?: { ascending?: boolean }) => { order = { c, asc: o?.ascending !== false }; return q; },
    limit: (n: number) => { limit = n; return q; },
    insert: (r: Row) => { op = 'insert'; payload = r; return q; },
    update: (r: Row) => { op = 'update'; payload = r; return q; },
    upsert: (r: Row) => { op = 'upsert'; payload = r; return q; },
    delete: () => { op = 'delete'; return q; },
    single: () => run('single'),
    maybeSingle: () => run('maybe'),
    then: (ok: any, bad: any) => run('many').then(ok, bad),
  };
  async function run(mode: 'single' | 'maybe' | 'many') {
    const t = (tables[table] ||= []);
    if (noAthleteCol && VERSIONED.includes(table) && (cols.includes('athlete_id') || (payload && 'athlete_id' in payload))) {
      return { data: null, error: { code: '42703', message: `column ${table}.athlete_id does not exist` } };
    }
    const match = (r: Row) => filters.every((f) => f(r));
    let out: Row[];
    // The real unique keys (migration 198): locks per (week, athlete), versions per (week, athlete, version).
    const key = (r: Row) => table === 'plan_edit_locks' ? `${r.week_start}|${r.athlete_id ?? ''}`
      : table === 'weekly_plan_versions' ? `${r.week_start}|${r.athlete_id ?? ''}|${r.version}` : null;
    if (op === 'insert' && key({ athlete_id: null, ...payload }) && t.some((x) => key(x) === key({ athlete_id: null, ...payload }))) {
      return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
    }
    if (op === 'insert') { const r = { id: `${table}-${++seq}`, created_at: new Date(seq * 1000).toISOString(), athlete_id: null, ...payload }; t.push(r); out = [r]; }
    else if (op === 'upsert') { t.push({ ...payload }); out = [payload!]; }
    else if (op === 'update') { out = t.filter(match); out.forEach((r) => Object.assign(r, payload)); }
    else if (op === 'delete') { out = t.filter(match); tables[table] = t.filter((r) => !match(r)); }
    else {
      out = t.filter(match);
      if (order) { const { c, asc } = order; out = [...out].sort((a, b) => (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1)); }
      if (limit != null) out = out.slice(0, limit);
    }
    if (mode === 'many') return { data: out, error: null };
    if (mode === 'single' && out.length !== 1) return { data: null, error: { message: `single: ${out.length} rows` } };
    return { data: out[0] ?? null, error: null };
  }
  return q;
}
const db: any = { from };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db }));

const S = await import('@/lib/plan-builder/server');

const W = '2026-11-22', PREV = '2026-11-15';
const MAYA = '11111111-1111-4111-8111-111111111111';
const NOA = '22222222-2222-4222-8222-222222222222';
const body = (name: string) => ({ workouts: [{ dayOfWeek: 1, name, steps: [] }] }) as any;
const ver = (o: Row) => ({ id: `v-${++seq}`, week_start: W, version: 1, state: 'published', plan_id: null, publish_at: null, publish_opts: null, published_at: null, athlete_id: null, body: body('x'), ...o });
const versions = (who: string | null) => tables.weekly_plan_versions.filter((v) => (v.athlete_id ?? null) === who);
const plans = (who: string | null) => (tables.weekly_plans || []).filter((p) => (p.athlete_id ?? null) === who);

beforeEach(() => {
  seq = 0; noAthleteCol = false; pushed.length = 0; notified.length = 0;
  tables = {
    weekly_plan_versions: [],
    plan_edit_locks: [],
    weekly_plans: [],
    plan_push_status: [],
    athletes: [
      { id: MAYA, name: 'Maya', status: 'active', is_academy: true, garmin_auth: 'g', groups: { name: 'קבוצה 1' } },
      { id: NOA, name: 'Noa', status: 'active', is_academy: false, garmin_auth: 'g', groups: { name: 'קבוצה 2' } },
    ],
  };
});

describe('versionsFor / draft lookup', () => {
  it('the group stream and a trainee stream never see each other', async () => {
    tables.weekly_plan_versions.push(ver({ id: 'g1', state: 'draft' }), ver({ id: 'm1', state: 'draft', athlete_id: MAYA }));
    expect((await S.versionsFor(db, W)).map((v) => v.id)).toEqual(['g1']);
    expect((await S.versionsFor(db, W, MAYA)).map((v) => v.id)).toEqual(['m1']);
    expect((await S.versionsFor(db, W, NOA))).toEqual([]);
    expect((await S.draftFor(db, W))?.id).toBe('g1');
    expect((await S.draftFor(db, W, MAYA))?.id).toBe('m1');
  });

  it('pre-migration: the group path runs unscoped (today\'s behaviour); a trainee path throws MigrationPending', async () => {
    noAthleteCol = true;
    tables.weekly_plan_versions.push({ id: 'g1', week_start: W, version: 1, state: 'draft', body: body('x') });
    expect((await S.versionsFor(db, W)).map((v) => v.id)).toEqual(['g1']);
    await expect(S.versionsFor(db, W, MAYA)).rejects.toBeInstanceOf(S.MigrationPending);
  });
});

describe('saveDraft', () => {
  it('a trainee draft is a new version of THEIR stream, numbered from it, and leaves the group draft alone', async () => {
    tables.weekly_plan_versions.push(ver({ id: 'g3', version: 3, state: 'draft' }));
    const d = await S.saveDraft(db, W, body('maya'), 'c1', MAYA);
    expect(d).toMatchObject({ athlete_id: MAYA, version: 1, state: 'draft' });
    expect(versions(null)).toHaveLength(1);
    expect(versions(null)[0].body).toEqual(body('x'));
    // and a second save updates that draft in place
    await S.saveDraft(db, W, body('maya2'), 'c1', MAYA);
    expect(versions(MAYA)).toHaveLength(1);
    expect(versions(MAYA)[0].body.workouts[0].name).toBe('maya2');
  });

  it('a group draft never picks up a trainee draft', async () => {
    tables.weekly_plan_versions.push(ver({ id: 'm1', version: 5, state: 'draft', athlete_id: MAYA }));
    const d = await S.saveDraft(db, W, body('club'), 'c1');
    expect(d.id).not.toBe('m1');
    expect(d).toMatchObject({ version: 1, athlete_id: null });
    expect(versions(MAYA)[0].body).toEqual(body('x'));
  });
});

describe('weekState', () => {
  it('a trainee week with no version of its own is the group week as a seed: fromClub', async () => {
    tables.weekly_plan_versions.push(ver({ id: 'g1', body: body('club') }));
    const s: any = await S.weekState(db, W, 'c1', MAYA);
    expect(s.fromClub).toBe(true);
    expect(s.athleteId).toBe(MAYA);
    expect(s.published).toBeNull();
    expect(s.draft).toMatchObject({ id: null, version: 0, athlete_id: MAYA, body: body('club') });
    expect(s.audience).toEqual({ runners: 1, garmin: 1, academy: 1 });
  });

  it('once the trainee has a version, fromClub is false and the group week is not shown', async () => {
    tables.weekly_plan_versions.push(ver({ id: 'g1', body: body('club') }), ver({ id: 'm1', state: 'draft', athlete_id: MAYA, body: body('maya') }));
    const s: any = await S.weekState(db, W, 'c1', MAYA);
    expect(s.fromClub).toBe(false);
    expect(s.draft.id).toBe('m1');
  });

  it('the group read is unchanged: no fromClub/athleteId keys', async () => {
    tables.weekly_plan_versions.push(ver({ id: 'm1', state: 'draft', athlete_id: MAYA }));
    const s: any = await S.weekState(db, W, 'c1');
    expect(s.draft).toBeNull();
    expect('fromClub' in s).toBe(false);
  });
});

describe('copyLastWeek', () => {
  it('a trainee copies their own previous week first', async () => {
    tables.weekly_plan_versions.push(ver({ week_start: PREV, body: body('club') }), ver({ week_start: PREV, athlete_id: MAYA, body: body('maya-prev') }));
    const d = await S.copyLastWeek(db, W, 'c1', MAYA);
    expect(d).toMatchObject({ athlete_id: MAYA, week_start: W });
    expect(d!.body.workouts[0].name).toBe('maya-prev');
    expect(versions(null).filter((v) => v.week_start === W)).toEqual([]);
  });

  it('…then their legacy row, then the GROUP previous week', async () => {
    tables.weekly_plan_versions.push(ver({ week_start: PREV, body: body('club') }));
    const d = await S.copyLastWeek(db, W, 'c1', MAYA);
    expect(d!.body.workouts[0].name).toBe('club');
    expect(d!.athlete_id).toBe(MAYA);
    tables.weekly_plans.push({ id: 'p-old', athlete_id: MAYA, week_start_date: PREV, coach_id: 'x', created_at: 'z', parsed_workouts: body('maya-legacy') });
    tables.weekly_plan_versions = tables.weekly_plan_versions.filter((v) => v.athlete_id !== MAYA);
    const d2 = await S.copyLastWeek(db, W, 'c1', MAYA);
    expect(d2!.body.workouts[0].name).toBe('maya-legacy');
  });
});

describe('locks', () => {
  it('a trainee lock is keyed by (week, athlete): it never locks the group week, and vice versa', async () => {
    expect((await S.takeLock(db, W, 'c1', 'Coach1', MAYA)).ok).toBe(true);
    expect((await S.takeLock(db, W, 'c2', 'Coach2')).ok).toBe(true);           // group free
    expect((await S.takeLock(db, W, 'c2', 'Coach2', MAYA)).ok).toBe(false);    // Maya's held by c1
    expect((await S.takeLock(db, W, 'c1', 'Coach1', NOA)).ok).toBe(true);
    expect(tables.plan_edit_locks.map((l) => [l.athlete_id, l.editor_id]).sort()).toEqual([[MAYA, 'c1'], [NOA, 'c1'], [null, 'c2']].sort());
    await S.releaseLock(db, W, 'c1', MAYA);
    expect(tables.plan_edit_locks.map((l) => l.athlete_id ?? null).sort()).toEqual([NOA, null].sort());
  });

  it('a release request reaches only the lock it names', async () => {
    await S.takeLock(db, W, 'c1', 'Coach1', MAYA);
    await S.takeLock(db, W, 'c3', 'Coach3');
    expect(await S.requestRelease(db, W, 'c2', 'Two', MAYA)).toBe(true);
    const [maya, group] = [tables.plan_edit_locks.find((l) => l.athlete_id === MAYA)!, tables.plan_edit_locks.find((l) => !l.athlete_id)!];
    expect(maya.release_requested_by).toBe('Two');
    expect(group.release_requested_by ?? null).toBeNull();
  });
});

describe('publishVersion', () => {
  it('a trainee publish writes THEIR weekly_plans row, supersedes only their version, pushes only them with paceTarget', async () => {
    tables.weekly_plans.push({ id: 'gp', athlete_id: null, week_start_date: W, status: 'published', parsed_workouts: body('club') });
    tables.weekly_plan_versions.push(ver({ id: 'g1', plan_id: 'gp', body: body('club') }), ver({ id: 'm1', athlete_id: MAYA, body: body('old') }));
    const draft = ver({ id: 'm2', version: 2, state: 'draft', athlete_id: MAYA, body: body('new') }) as any;
    tables.weekly_plan_versions.push(draft);
    const r = await S.publishVersion(db, draft, S.defaultOpts({ notify: true, push: true, overwriteWatch: true }), 'c1');
    expect(plans(MAYA)).toHaveLength(1);
    expect(plans(MAYA)[0]).toMatchObject({ id: r.planId, status: 'published', week_start_date: W });
    expect(plans(null)[0]).toMatchObject({ id: 'gp', status: 'published', parsed_workouts: body('club') });
    expect(tables.weekly_plan_versions.find((v) => v.id === 'g1')!.state).toBe('published');
    expect(tables.weekly_plan_versions.find((v) => v.id === 'm1')!.state).toBe('superseded');
    expect(tables.weekly_plan_versions.find((v) => v.id === 'm2')!.state).toBe('published');
    expect(pushed).toEqual([`${MAYA}:true`]);
    expect(notified.map((n) => n.athleteId)).toEqual([MAYA]); // no staff copy for a trainee week
  });

  it('a group publish never touches a trainee row or version', async () => {
    tables.weekly_plans.push({ id: 'mp', athlete_id: MAYA, week_start_date: W, status: 'published', parsed_workouts: body('maya') });
    tables.weekly_plan_versions.push(ver({ id: 'm1', athlete_id: MAYA, plan_id: 'mp' }));
    const draft = ver({ id: 'g1', state: 'draft', body: body('club') }) as any;
    tables.weekly_plan_versions.push(draft);
    await S.publishVersion(db, draft, S.defaultOpts({ notify: false, push: true }), 'c1');
    expect(plans(MAYA)[0]).toMatchObject({ id: 'mp', parsed_workouts: body('maya') });
    expect(plans(null)).toHaveLength(1);
    expect(tables.weekly_plan_versions.find((v) => v.id === 'm1')!.state).toBe('published');
    expect(pushed.sort()).toEqual([`${MAYA}:true`, `${NOA}:false`].sort());
  });
});

describe('unpublish', () => {
  it('a trainee unpublish drafts their row only; the group row stays published', async () => {
    tables.weekly_plans.push({ id: 'gp', athlete_id: null, week_start_date: W, status: 'published' }, { id: 'mp', coach_id: (await import('@/lib/constants')).COACH_ID, athlete_id: MAYA, week_start_date: W, status: 'published', created_at: 'a' });
    tables.weekly_plan_versions.push(ver({ id: 'g1' }), ver({ id: 'm1', athlete_id: MAYA }));
    expect(await S.unpublish(db, W, MAYA)).toBe(true);
    expect(plans(MAYA)[0].status).toBe('draft');
    expect(plans(null)[0].status).toBe('published');
    expect(tables.weekly_plan_versions.find((v) => v.id === 'g1')!.state).toBe('published');
    expect(tables.weekly_plan_versions.find((v) => v.id === 'm1')!.state).toBe('unpublished');
  });

  it('a group unpublish with only a trainee version published is a no-op', async () => {
    tables.weekly_plan_versions.push(ver({ id: 'm1', athlete_id: MAYA }));
    expect(await S.unpublish(db, W)).toBe(false);
    expect(tables.weekly_plan_versions[0].state).toBe('published');
  });
});

describe('runScheduledPlanPublishes', () => {
  it('a due trainee version publishes into the trainee stream, next to a due group version', async () => {
    tables.weekly_plan_versions.push(
      ver({ id: 'g1', state: 'scheduled', publish_at: '2026-11-21T00:00:00Z', publish_opts: { notify: false, push: false, overwriteWatch: false } }),
      ver({ id: 'm1', state: 'scheduled', athlete_id: MAYA, publish_at: '2026-11-21T00:00:00Z', publish_opts: { notify: false, push: false, overwriteWatch: false } }),
    );
    const fired = await S.runScheduledPlanPublishes(db, new Date('2026-11-22T00:00:00Z'));
    expect(fired).toHaveLength(2);
    expect(plans(null)).toHaveLength(1);
    expect(plans(MAYA)).toHaveLength(1);
    expect(tables.weekly_plan_versions.every((v) => v.state === 'published')).toBe(true);
  });

  it('the retry guard compares a trainee version against the trainee stream, not the group\'s', async () => {
    tables.weekly_plan_versions.push(ver({ id: 'g1', version: 9 }), ver({ id: 'm1', athlete_id: MAYA, plan_id: 'mp' }));
    tables.plan_push_status.push({ version_id: 'm1', athlete_id: MAYA, state: 'backoff', retry_at: '2026-11-21T00:00:00Z', attempts: 1 });
    const fired = await S.runScheduledPlanPublishes(db, new Date('2026-11-22T00:00:00Z'));
    expect(fired).toEqual(['planPushRetry 1']);
    expect(pushed).toEqual([`${MAYA}:true`]);
  });
});

describe('writeIndividualWeek (academy day-plan / copy-week)', () => {
  it('writes the trainee row and records it as their published version, superseding the previous one', async () => {
    tables.weekly_plan_versions.push(ver({ id: 'g1' }), ver({ id: 'm1', athlete_id: MAYA }));
    const r = await S.writeIndividualWeek(db, { athleteId: MAYA, weekStart: W, parsed: body('day'), status: 'published', by: 'c1' });
    expect(r.error).toBeNull();
    expect(plans(MAYA)[0]).toMatchObject({ id: r.planId, athlete_id: MAYA });
    expect(plans(null)).toEqual([]);
    const mine = versions(MAYA).sort((a, b) => a.version - b.version);
    expect(mine.map((v) => [v.version, v.state])).toEqual([[1, 'superseded'], [2, 'published']]);
    expect(mine[1].plan_id).toBe(r.planId);
    expect(tables.weekly_plan_versions.find((v) => v.id === 'g1')!.state).toBe('published');
  });

  it('pre-migration: the row is still written (the academy tools keep working), no version, group untouched', async () => {
    noAthleteCol = true;
    const r = await S.writeIndividualWeek(db, { athleteId: MAYA, weekStart: W, parsed: body('day'), status: 'published' });
    expect(r.error).toBeNull();
    expect(plans(MAYA)).toHaveLength(1);
    expect(tables.weekly_plan_versions).toEqual([]);
  });

  it('refuses an empty athlete id rather than writing the group row', async () => {
    const r = await S.writeIndividualWeek(db, { athleteId: '', weekStart: W, parsed: body('day'), status: 'published' });
    expect(r.planId).toBeNull();
    expect(tables.weekly_plans).toEqual([]);
  });
});

// ── Routes and the gate ─────────────────────────────────────────────────────

const weekRoute = await import('@/app/api/plan-builder/weeks/[week]/route');
const publishRoute = await import('@/app/api/plan-builder/weeks/[week]/publish/route');
const lockRoute = await import('@/app/api/plan-builder/weeks/[week]/lock/route');
const copyRoute = await import('@/app/api/plan-builder/weeks/[week]/copy-last/route');
const wk = { params: Promise.resolve({ week: W }) };
const req = (q: string, method = 'GET', b?: unknown) => new Request(`http://x/w${q}`, { method, body: b ? JSON.stringify(b) : undefined }) as any;
const coach = { athleteId: 'c1', email: 'c@x', isStaff: true };
const forbidden = () => new Response(JSON.stringify({ error: 'Not your trainee' }), { status: 403 });

describe('routes with ?athleteId', () => {
  beforeEach(() => {
    traineeAccess.mockClear();
    access = { denied: null, caller: coach };
    staffCaller = { denied: null, caller: coach };
  });

  it('gate on requireTraineeAccess for THAT athlete; 403 when not their trainee', async () => {
    access = { denied: forbidden(), caller: coach };
    for (const r of [
      weekRoute.GET(req(`?athleteId=${MAYA}`), wk),
      weekRoute.PUT(req(`?athleteId=${MAYA}`, 'PUT', { body: { workouts: [] } }), wk),
      publishRoute.POST(req(`?athleteId=${MAYA}`, 'POST', { mode: 'now' }), wk),
      lockRoute.POST(req(`?athleteId=${MAYA}`, 'POST'), wk),
      lockRoute.DELETE(req(`?athleteId=${MAYA}`, 'DELETE'), wk),
      copyRoute.POST(req(`?athleteId=${MAYA}`, 'POST'), wk),
    ]) expect((await r).status).toBe(403);
    expect(traineeAccess.mock.calls.every((c: any[]) => c[1] === MAYA)).toBe(true);
    expect(tables.weekly_plan_versions).toEqual([]);
  });

  it('a malformed athleteId is a 400, not a group read', async () => {
    expect((await weekRoute.GET(req('?athleteId=nope'), wk)).status).toBe(400);
    expect(traineeAccess).not.toHaveBeenCalled();
  });

  it('without athleteId the staff gate runs and trainee access is never consulted', async () => {
    expect((await weekRoute.GET(req(''), wk)).status).toBe(200);
    expect(traineeAccess).not.toHaveBeenCalled();
  });

  it('PUT → publish now: the trainee row is written and only they are pushed', async () => {
    expect((await weekRoute.PUT(req(`?athleteId=${MAYA}`, 'PUT', { body: { workouts: [{ dayOfWeek: 2, name: 'm', steps: [] }] } }), wk)).status).toBe(200);
    const r = await publishRoute.POST(req(`?athleteId=${MAYA}`, 'POST', { mode: 'now', notify: false, push: true, overwriteWatch: true }), wk);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ published: true, pushed: 1 });
    expect(plans(MAYA)).toHaveLength(1);
    expect(plans(null)).toEqual([]);
    expect(pushed).toEqual([`${MAYA}:true`]);
  });

  it('publish with no trainee draft is 409 even when the group has one', async () => {
    tables.weekly_plan_versions.push(ver({ id: 'g1', state: 'draft' }));
    expect((await publishRoute.POST(req(`?athleteId=${MAYA}`, 'POST', { mode: 'now' }), wk)).status).toBe(409);
    expect(tables.weekly_plan_versions[0].state).toBe('draft');
  });

  it('copy-last with nothing anywhere is 404', async () => {
    expect((await copyRoute.POST(req(`?athleteId=${MAYA}`, 'POST'), wk)).status).toBe(404);
  });

  it('a held trainee lock is 409 on PUT for another coach', async () => {
    await S.takeLock(db, W, 'c9', 'Nine', MAYA);
    expect((await weekRoute.PUT(req(`?athleteId=${MAYA}`, 'PUT', { body: { workouts: [] } }), wk)).status).toBe(409);
    expect((await weekRoute.PUT(req('', 'PUT', { body: { workouts: [] } }), wk)).status).toBe(200); // group week free
  });

  it('pre-migration: every trainee route is 503 migration_pending and nothing is written', async () => {
    noAthleteCol = true;
    tables.weekly_plan_versions.push({ id: 'g1', week_start: W, version: 1, state: 'draft', body: body('x') });
    for (const r of [
      weekRoute.GET(req(`?athleteId=${MAYA}`), wk),
      weekRoute.PUT(req(`?athleteId=${MAYA}`, 'PUT', { body: { workouts: [] } }), wk),
      publishRoute.POST(req(`?athleteId=${MAYA}`, 'POST', { mode: 'now' }), wk),
      lockRoute.POST(req(`?athleteId=${MAYA}`, 'POST'), wk),
      copyRoute.POST(req(`?athleteId=${MAYA}`, 'POST'), wk),
    ]) {
      const res = await r;
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe('migration_pending');
    }
    expect(tables.weekly_plans).toEqual([]);
    expect(tables.weekly_plan_versions).toHaveLength(1);
    expect(tables.weekly_plan_versions[0].state).toBe('draft');
    // and the group week still reads pre-migration
    expect((await weekRoute.GET(req(''), wk)).status).toBe(200);
  });
});

describe('follow-up review fixes', () => {
  beforeEach(() => { access = { denied: null, caller: coach }; staffCaller = { denied: null, caller: coach }; });

  it('two coaches taking a free lock at once: the loser gets ok:false with the winner\'s lock, not a 500', async () => {
    // c1's insert lands between c2's read (free) and c2's insert.
    const realFrom = db.from;
    let raced = false;
    db.from = (t: string) => {
      const q = realFrom(t);
      if (t === 'plan_edit_locks' && !raced) {
        const ins = q.insert;
        q.insert = (row: Row) => { raced = true; tables.plan_edit_locks.push({ week_start: W, athlete_id: MAYA, editor_id: 'c1', editor_name: 'One', heartbeat_at: new Date().toISOString() }); return ins(row); };
      }
      return q;
    };
    try {
      const r = await S.takeLock(db, W, 'c2', 'Two', MAYA);
      expect(r.ok).toBe(false);
      expect(r.lock).toMatchObject({ state: 'other', editorName: 'One' });
    } finally { db.from = realFrom; }
  });

  it('?athleteId of a non-academy club runner is 403 not_academy, and nothing is written', async () => {
    access = { denied: null, caller: coach, pair: { isAcademy: false } };
    const res = await weekRoute.PUT(req(`?athleteId=${NOA}`, 'PUT', { body: { workouts: [] } }), wk);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('not_academy');
    expect(tables.weekly_plan_versions).toEqual([]);
  });

  it('a removed (inactive) trainee is neither pushed nor notified on publish', async () => {
    tables.athletes[0].status = 'removed';
    const draft = ver({ id: 'm1', state: 'draft', athlete_id: MAYA }) as any;
    tables.weekly_plan_versions.push(draft);
    const r = await S.publishVersion(db, draft, S.defaultOpts({ notify: true, push: true }), 'c1');
    expect(r).toMatchObject({ notified: 0, pushed: 0 });
    expect(pushed).toEqual([]);
    expect(notified).toEqual([]);
  });

  it('an academy send cancels a pending SCHEDULED trainee version (kept as draft), so it cannot wipe the send later', async () => {
    tables.weekly_plan_versions.push(ver({ id: 'm1', version: 1, state: 'scheduled', athlete_id: MAYA, publish_at: '2026-11-23T00:00:00Z' }), ver({ id: 'g1', state: 'scheduled', publish_at: '2026-11-23T00:00:00Z' }));
    await S.writeIndividualWeek(db, { athleteId: MAYA, weekStart: W, parsed: body('day'), status: 'published' });
    expect(tables.weekly_plan_versions.find((v) => v.id === 'm1')).toMatchObject({ state: 'draft', publish_at: null });
    expect(tables.weekly_plan_versions.find((v) => v.id === 'g1')!.state).toBe('scheduled'); // group untouched
    const fired = await S.runScheduledPlanPublishes(db, new Date('2026-11-24T00:00:00Z'));
    expect(fired.every((f) => !f.includes(MAYA))).toBe(true);
    expect(plans(MAYA)[0].parsed_workouts).toEqual(body('day'));
  });

  it('a plain trainee draft is left alone by an academy send', async () => {
    tables.weekly_plan_versions.push(ver({ id: 'm1', version: 1, state: 'draft', athlete_id: MAYA }));
    await S.writeIndividualWeek(db, { athleteId: MAYA, weekStart: W, parsed: body('day'), status: 'published' });
    expect(tables.weekly_plan_versions.find((v) => v.id === 'm1')!.state).toBe('draft');
  });

  it('a concurrent version insert re-reads and takes the next number instead of losing the record', async () => {
    const realFrom = db.from;
    let raced = false;
    db.from = (t: string) => {
      const q = realFrom(t);
      if (t === 'weekly_plan_versions' && !raced) {
        const ins = q.insert;
        q.insert = (row: Row) => { raced = true; tables.weekly_plan_versions.push(ver({ id: 'other', version: 1, state: 'draft', athlete_id: MAYA })); return ins(row); };
      }
      return q;
    };
    try {
      await S.writeIndividualWeek(db, { athleteId: MAYA, weekStart: W, parsed: body('day'), status: 'published' });
    } finally { db.from = realFrom; }
    expect(versions(MAYA).map((v) => [v.version, v.state]).sort()).toEqual([[1, 'draft'], [2, 'published']]);
  });
});

// ── Night queue #62 / #64 ────────────────────────────────────────────────────
describe('legacy group row + stale-lock takeover', () => {
  it('#62: two group rows for one week (old race) no longer 500 — the newest of this coach is updated', async () => {
    const { COACH_ID } = await import('@/lib/constants');
    tables.weekly_plans.push(
      { id: 'old', coach_id: COACH_ID, week_start_date: W, athlete_id: null, created_at: '2026-11-01T00:00:00Z', parsed_workouts: {} },
      { id: 'new', coach_id: COACH_ID, week_start_date: W, athlete_id: null, created_at: '2026-11-02T00:00:00Z', parsed_workouts: {} },
      { id: 'other-coach', coach_id: 'someone-else', week_start_date: W, athlete_id: null, created_at: '2026-11-03T00:00:00Z', parsed_workouts: {} },
    );
    const v = ver({ state: 'draft' });
    tables.weekly_plan_versions.push(v);
    await S.publishVersion(db, v as any, { notify: false } as any, 'c1');
    expect(plans(null)).toHaveLength(3);                                   // nothing inserted
    expect(tables.weekly_plans.find((p) => p.id === 'new')?.status).toBe('published');
    expect(tables.weekly_plans.find((p) => p.id === 'other-coach')?.status).toBeUndefined();
  });

  it('#64: two coaches taking the same stale lock at once — exactly one is told ok', async () => {
    tables.plan_edit_locks.push({ week_start: W, athlete_id: null, editor_id: 'gone', editor_name: 'Gone', heartbeat_at: '2026-01-01T00:00:00Z' });
    const [a, b] = await Promise.all([S.takeLock(db, W, 'c1', 'Coach1'), S.takeLock(db, W, 'c2', 'Coach2')]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const winner = a.ok ? 'c1' : 'c2';
    expect(tables.plan_edit_locks).toHaveLength(1);
    expect(tables.plan_edit_locks[0].editor_id).toBe(winner);
    expect((a.ok ? b : a).lock.state).toBe('other');
  });

  it('#64: refreshing my own live lock still works', async () => {
    expect((await S.takeLock(db, W, 'c1', 'Coach1')).ok).toBe(true);
    expect((await S.takeLock(db, W, 'c1', 'Coach1')).ok).toBe(true);
  });
});
