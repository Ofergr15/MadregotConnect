import { beforeEach, describe, expect, it, vi } from 'vitest';

/** /api/plans/nutrition: GET is members-only, writes (POST / PUT / DELETE) staff-only. */
let session: { ok: boolean; user?: { isStaff: boolean } } = { ok: true, user: { isStaff: true } };
let memberDenied: Response | null = null;
let result: { data: unknown; error: unknown } = { data: null, error: null };
const ops: Array<[string, unknown?]> = [];

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => session,
  authError: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/auth/self-or-staff', () => ({ requireMember: async () => memberDenied }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const q: any = {};
      for (const op of ['select', 'eq', 'order', 'insert', 'update', 'delete']) q[op] = (a?: unknown) => { ops.push([op, a]); return q; };
      q.single = async () => result;
      q.maybeSingle = async () => result;
      q.then = (ok: any) => Promise.resolve(result).then(ok);
      return q;
    },
  }),
}));

const { GET, POST, PUT, DELETE } = await import('@/app/api/plans/nutrition/route');
const U = 'http://x/api/plans/nutrition';
const body = (method: string, b: unknown) => new Request(U, { method, body: JSON.stringify(b) });

beforeEach(() => { session = { ok: true, user: { isStaff: true } }; memberDenied = null; result = { data: null, error: null }; ops.length = 0; });

describe('/api/plans/nutrition', () => {
  it('GET needs a verified member', async () => {
    memberDenied = new Response(null, { status: 401 });
    expect((await GET(new Request(U))).status).toBe(401);
    expect(ops).toHaveLength(0);
    memberDenied = null; result = { data: [{ id: 'p1' }], error: null };
    expect(await (await GET(new Request(U))).json()).toEqual({ plans: [{ id: 'p1' }] });
  });
  it('writes are staff-only and refused before the database', async () => {
    session = { ok: true, user: { isStaff: false } };
    expect((await POST(body('POST', { week_label: 'w', content: 'c' }))).status).toBe(403);
    expect((await PUT(body('PUT', { id: 'p1', content: 'c' }))).status).toBe(403);
    expect((await DELETE(new Request(`${U}?id=p1`, { method: 'DELETE' }))).status).toBe(403);
    session = { ok: false };
    expect((await PUT(body('PUT', { id: 'p1', content: 'c' }))).status).toBe(401);
    expect(ops).toHaveLength(0);
  });
  it('PUT edits only week_label / content, in place', async () => {
    expect((await PUT(body('PUT', { content: 'c' }))).status).toBe(400);
    expect((await PUT(body('PUT', { id: 'p1' }))).status).toBe(400);
    expect((await PUT(body('PUT', { id: 'p1', content: '' }))).status).toBe(400);
    result = { data: null, error: null };
    expect((await PUT(body('PUT', { id: 'p1', content: 'c' }))).status).toBe(404);
    result = { data: { id: 'p1', content: 'new' }, error: null };
    ops.length = 0;
    const r = await PUT(body('PUT', { id: 'p1', content: 'new', coach_id: 'evil', type: 'x' }));
    expect(await r.json()).toEqual({ plan: { id: 'p1', content: 'new' } });
    expect(ops.find(([o]) => o === 'update')?.[1]).toEqual({ content: 'new' });
    expect(ops.filter(([o]) => o === 'eq').map(([, a]) => a)).toEqual(expect.arrayContaining(['id', 'coach_id', 'type']));
  });
});
