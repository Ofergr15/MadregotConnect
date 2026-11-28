import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveFeature, mayToggle, allowedScopeTypes, SCOPE_TYPES, type EnablementRow } from '@/lib/features/flags';
import { cleanColor, cleanGroupName } from '@/lib/access-groups/store';

// ── Resolution: athlete > access_group > squad > academy > role > club > default ──
const row = (scope_type: EnablementRow['scope_type'], scope_id: string, enabled: boolean): EnablementRow =>
  ({ feature: 'history', scope_type, scope_id, enabled });
const ofer = { id: 'a1', role: 'admin', groupId: 'p1', accessGroupIds: ['g-owners', 'g-core'] };

describe('access_group scope in resolveFeature', () => {
  it('a group row applies only to its members', () => {
    expect(resolveFeature('history', [row('access_group', 'g-owners', true)], ofer).enabled).toBe(true);
    expect(resolveFeature('history', [row('access_group', 'g-owners', true)], { ...ofer, accessGroupIds: [] }).enabled).toBe(false);
  });
  it('group beats role and squad', () => {
    const r = resolveFeature('history', [row('role', 'admin', false), row('squad', 'p1', false), row('access_group', 'g-core', true)], ofer);
    expect(r.enabled).toBe(true);
    expect(r.source?.scopeType).toBe('access_group');
  });
  it('personal beats group', () => {
    expect(resolveFeature('history', [row('access_group', 'g-core', true), row('athlete', 'a1', false)], ofer).enabled).toBe(false);
  });
  it('two groups disagree → explicit OFF wins, in either order', () => {
    const on = row('access_group', 'g-owners', true), off = row('access_group', 'g-core', false);
    expect(resolveFeature('history', [on, off], ofer).enabled).toBe(false);
    expect(resolveFeature('history', [off, on], ofer).enabled).toBe(false);
  });
  it('no memberships field (pre-222) behaves as before', () => {
    expect(resolveFeature('history', [row('access_group', 'g-core', true)], { id: 'a1', role: 'admin' }).enabled).toBe(false);
  });
  it('only an admin may write the scope', () => {
    expect(allowedScopeTypes({ athleteId: 'x', role: 'admin', isSuperUser: false })).toHaveLength(SCOPE_TYPES.length);
    expect(allowedScopeTypes({ athleteId: 'x', role: 'coach', isSuperUser: false })).not.toContain('access_group');
    expect(mayToggle({ athleteId: 'x', role: 'coach', isSuperUser: false }, { scopeType: 'access_group', scopeId: 'g', feature: 'history' })).toBe(false);
    expect(mayToggle({ athleteId: 'x', role: 'academy_manager', isSuperUser: false }, { scopeType: 'access_group', scopeId: 'g', feature: 'history' })).toBe(false);
  });
});

describe('input cleaning', () => {
  it('names: trimmed, collapsed, 1–60', () => {
    expect(cleanGroupName('  פיילוט   אקדמיה ')).toBe('פיילוט אקדמיה');
    expect(cleanGroupName('   ')).toBeNull();
    expect(cleanGroupName('א'.repeat(61))).toBeNull();
    expect(cleanGroupName(5)).toBeNull();
  });
  it('colours: #RRGGBB only', () => {
    expect(cleanColor('#1525ff')).toBe('#1525FF');
    expect(cleanColor('red')).toBeNull();
    expect(cleanColor('#123')).toBeNull();
  });
});

// ── Routes: admin-only, JWT identity, 503 before 222 ──
type Caller = { athleteId: string | null; email: string; role: string; roles?: string[]; isSuperUser: boolean; isStaff: boolean; viewingAsBy?: string };
let caller: Caller;
let deniedResp: Response | null = null;
const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
let tableError: Record<string, unknown> = {};

vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => ({ denied: deniedResp, caller }),
}));

function chain(table: string) {
  const state: { op: string; payload?: unknown } = { op: 'select' };
  const result = () => {
    calls.push({ table, ...state });
    const err = tableError[table];
    if (err) return { data: null, error: err };
    if (table === 'access_groups' && state.op === 'insert') return { data: { id: 'g-new', name: (state.payload as any).name, color: (state.payload as any).color }, error: null };
    if (table === 'access_groups' && state.op === 'select') return { data: { id: 'g1', name: 'גרעין', color: '#00AA55' }, error: null };
    if (table === 'athletes') return { data: [{ id: 'a2' }], error: null };
    return { data: state.op === 'select' ? [] : null, error: null };
  };
  const c: any = {
    select: () => c, eq: () => c, in: () => c, order: () => c, limit: () => c,
    insert: (p: unknown) => { state.op = 'insert'; state.payload = p; return c; },
    upsert: (p: unknown) => { state.op = 'upsert'; state.payload = p; return c; },
    update: (p: unknown) => { state.op = 'update'; state.payload = p; return c; },
    delete: () => { state.op = 'delete'; return c; },
    single: async () => result(), maybeSingle: async () => result(),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
  };
  return c;
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => chain(t) }) }));

const groupsRoute = await import('@/app/api/admin/access-groups/route');
const membersRoute = await import('@/app/api/admin/access-groups/[id]/members/route');
const screensRoute = await import('@/app/api/admin/access-groups/[id]/screens/route');
const oneRoute = await import('@/app/api/admin/access-groups/[id]/route');

const admin: Caller = { athleteId: 'a1', email: 'o@x', role: 'admin', roles: ['admin'], isSuperUser: false, isStaff: true };
const coach: Caller = { athleteId: 'c1', email: 'c@x', role: 'coach', roles: ['coach'], isSuperUser: false, isStaff: true };
const req = (method: string, body?: unknown, url = 'https://x.test/api/admin/access-groups') =>
  new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const ctx = { params: Promise.resolve({ id: 'g1' }) };

beforeEach(() => { calls.length = 0; tableError = {}; deniedResp = null; caller = admin; });

describe('access-group routes', () => {
  it('unauthenticated → the session denial', async () => {
    deniedResp = new Response('{}', { status: 401 });
    expect((await groupsRoute.GET(req('GET'))).status).toBe(401);
  });
  it('a coach is refused every read and write', async () => {
    caller = coach;
    expect((await groupsRoute.GET(req('GET'))).status).toBe(403);
    expect((await groupsRoute.POST(req('POST', { name: 'x' }))).status).toBe(403);
    expect((await membersRoute.POST(req('POST', { athleteIds: ['a2'] }), ctx)).status).toBe(403);
    expect((await screensRoute.PUT(req('PUT', { feature: 'history', enabled: true }), ctx)).status).toBe(403);
    expect((await oneRoute.DELETE(req('DELETE'), ctx)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('writes are refused while viewing as', async () => {
    caller = { ...admin, viewingAsBy: 'o@x' };
    expect((await groupsRoute.POST(req('POST', { name: 'x' }))).status).toBe(403);
  });
  it('create: audited, actor from the JWT not the body', async () => {
    const r = await groupsRoute.POST(req('POST', { name: 'בעלים', color: '#1525ff', created_by: 'evil' }));
    expect(r.status).toBe(201);
    const ins = calls.find((c) => c.table === 'access_groups' && c.op === 'insert');
    expect((ins?.payload as any).created_by).toBe('a1');
    expect(calls.some((c) => c.table === 'access_group_audit' && c.op === 'insert')).toBe(true);
  });
  it('create: bad name / colour → 400', async () => {
    expect((await groupsRoute.POST(req('POST', { name: ' ' }))).status).toBe(400);
    expect((await groupsRoute.POST(req('POST', { name: 'x', color: 'blue' }))).status).toBe(400);
  });
  it('503 while 222 is unapplied', async () => {
    tableError = { access_groups: { code: '42P01', message: 'relation "access_groups" does not exist' } };
    expect((await groupsRoute.GET(req('GET'))).status).toBe(503);
  });
  it('screens: writes the access_group scope and audits it', async () => {
    const r = await screensRoute.PUT(req('PUT', { feature: 'history', enabled: false }), ctx);
    expect(r.status).toBe(200);
    const up = calls.find((c) => c.table === 'feature_enablements' && c.op === 'upsert');
    expect(up?.payload).toMatchObject({ feature: 'history', scope_type: 'access_group', scope_id: 'g1', enabled: false, set_by: 'a1' });
    expect(calls.some((c) => c.table === 'feature_enablement_audit')).toBe(true);
  });
  it('screens: unknown key → 400', async () => {
    expect((await screensRoute.PUT(req('PUT', { feature: 'nope', enabled: true }), ctx)).status).toBe(400);
  });
  it('members: only real athletes are added', async () => {
    const r = await membersRoute.POST(req('POST', { athleteIds: ['a2', 'ghost'] }), ctx);
    expect(await r.json()).toEqual({ added: ['a2'] });
  });
  it('delete clears the group screens too', async () => {
    expect((await oneRoute.DELETE(req('DELETE'), ctx)).status).toBe(200);
    expect(calls.some((c) => c.table === 'feature_enablements' && c.op === 'delete')).toBe(true);
    expect(calls.some((c) => c.table === 'access_groups' && c.op === 'delete')).toBe(true);
  });
});
