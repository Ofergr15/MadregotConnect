import { beforeEach, describe, expect, it, vi } from 'vitest';

let denied: Response | null = null;
let result: { data: unknown; error: unknown } = { data: null, error: null };
const calls: { op: string; arg?: unknown }[] = [];

vi.mock('@/lib/auth/require-approver', () => ({
  requireApprover: async () => ({ denied, email: denied ? '' : 'coach@x' }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const obj: Record<string, unknown> = {};
      for (const op of ['select', 'order', 'insert', 'update', 'delete', 'eq']) {
        obj[op] = (arg?: unknown) => { calls.push({ op, arg }); return obj; };
      }
      obj.single = async () => result;
      obj.maybeSingle = async () => result;
      obj.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
      return obj;
    },
  }),
}));

import { DELETE, GET, PATCH, POST } from '@/app/api/admin/surveys/recurring/route';

const U = 'http://x/api/admin/surveys/recurring';
const json = (method: string, body: unknown) => new Request(U, { method, body: JSON.stringify(body) });
const valid = { day_of_week: 2, question_he: 'מי בא?', options_he: ['1', '2'] };

beforeEach(() => { denied = null; result = { data: null, error: null }; calls.length = 0; });

describe('/api/admin/surveys/recurring', () => {
  it('every method is gated before the database', async () => {
    denied = new Response('{}', { status: 403 });
    for (const r of [GET(new Request(U)), POST(json('POST', valid)), PATCH(json('PATCH', { id: 'a', active: false })), DELETE(new Request(`${U}?id=a`, { method: 'DELETE' }))]) {
      expect((await r).status).toBe(403);
    }
    expect(calls).toHaveLength(0);
  });
  it('GET lists; 503 when the table is missing', async () => {
    result = { data: [{ id: 'a', day_of_week: 2 }], error: null };
    expect(await (await GET(new Request(U))).json()).toEqual({ templates: [{ id: 'a', day_of_week: 2 }] });
    result = { data: null, error: { code: '42P01', message: 'x' } };
    expect((await GET(new Request(U))).status).toBe(503);
    result = { data: null, error: { code: 'PGRST205', message: 'x' } };
    expect((await POST(json('POST', valid))).status).toBe(503);
  });
  it('day_of_week must be an integer 0–6', async () => {
    for (const d of [-1, 7, 2.5, '2']) expect((await POST(json('POST', { ...valid, day_of_week: d }))).status).toBe(400);
    expect((await PATCH(json('PATCH', { id: 'a', day_of_week: 9 }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('POST creates (201), duplicate day is 409, missing fields 400', async () => {
    result = { data: { id: 'n', ...valid }, error: null };
    expect((await POST(json('POST', valid))).status).toBe(201);
    result = { data: null, error: { code: '23505', message: 'dup' } };
    expect((await POST(json('POST', valid))).status).toBe(409);
    expect((await POST(json('POST', { day_of_week: 1 }))).status).toBe(400);
  });
  it('PATCH needs id and a field; unknown id is 404', async () => {
    expect((await PATCH(json('PATCH', { active: false }))).status).toBe(400);
    expect((await PATCH(json('PATCH', { id: 'a' }))).status).toBe(400);
    result = { data: null, error: null };
    expect((await PATCH(json('PATCH', { id: 'a', active: false }))).status).toBe(404);
    result = { data: { id: 'a', active: false }, error: null };
    expect((await PATCH(json('PATCH', { id: 'a', active: false }))).status).toBe(200);
  });
  it('DELETE by ?id', async () => {
    expect((await DELETE(new Request(U, { method: 'DELETE' }))).status).toBe(400);
    result = { data: [], error: null };
    expect((await DELETE(new Request(`${U}?id=a`, { method: 'DELETE' }))).status).toBe(404);
    result = { data: [{ id: 'a' }], error: null };
    expect((await DELETE(new Request(`${U}?id=a`, { method: 'DELETE' }))).status).toBe(200);
  });
});
