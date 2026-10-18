import { beforeEach, describe, expect, it, vi } from 'vitest';

/** POST /api/club-updates: only a writer posts; a quiet update schedules no push. */

const caller = vi.fn();
vi.mock('@/lib/club-updates/access', () => ({
  clubUpdatesCaller: () => caller(),
  forbidden: () => new Response(JSON.stringify({ error: 'Not allowed' }), { status: 403 }),
}));
const after = vi.fn();
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => void) => after(fn) }));
const insert = vi.fn();
const db = { from: () => ({ insert: (row: unknown) => { insert(row); return { select: () => ({ single: async () => ({ data: { id: 'u1', ...(row as object), created_at: 'now' }, error: null }) }) }; } }) };
vi.mock('@/lib/club-updates/server', () => ({
  isMissingTable: () => false,
  listUpdates: async () => ({ updates: [], missing: false }),
  project: async (_db: unknown, rows: unknown[]) => rows,
  sendUpdatePush: vi.fn(),
  wantsPush: (body: string, breaking: boolean) => breaking || body.includes('@['),
}));

const { POST, GET } = await import('@/app/api/club-updates/route');
const post = (b: unknown) => POST(new Request('http://x/api/club-updates', { method: 'POST', body: JSON.stringify(b) }));
const as = (access: { admin: boolean; canWrite: boolean; canRead: boolean }, enabled = true) =>
  caller.mockResolvedValue({ denied: null, db, athleteId: 'me', access, cfg: { enabled, writerIds: [] } });

beforeEach(() => { caller.mockReset(); insert.mockReset(); after.mockReset(); });

describe('club updates route', () => {
  it('refuses a member who is not a writer', async () => {
    as({ admin: false, canWrite: false, canRead: true });
    expect((await post({ body: 'hi' })).status).toBe(403);
    expect(insert).not.toHaveBeenCalled();
  });
  it('a writer posts; a plain update sends nothing', async () => {
    as({ admin: false, canWrite: true, canRead: true });
    const res = await post({ body: 'נפגשים בשער 2' });
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ author_athlete_id: 'me', breaking: false, notify_at: null }));
    expect(after).not.toHaveBeenCalled();
  });
  it('a breaking update waits out the undo window before its push', async () => {
    as({ admin: true, canWrite: true, canRead: true });
    await post({ body: 'שי סיים!', breaking: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ breaking: true, notify_at: expect.any(String) }));
    expect(after).toHaveBeenCalledTimes(1);
  });
  it('rejects an update over 280 characters', async () => {
    as({ admin: true, canWrite: true, canRead: true });
    expect((await post({ body: 'א'.repeat(281) })).status).toBe(400);
  });
  it('tells a member nothing while it is off', async () => {
    as({ admin: false, canWrite: false, canRead: false }, false);
    const body = await (await GET(new Request('http://x/api/club-updates?feed=1'))).json();
    expect(body).toEqual({ enabled: false, updates: [] });
  });
});
