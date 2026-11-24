import { beforeEach, describe, expect, it, vi } from 'vitest';

/** POST /api/notifications/seen: stamps ONLY the verified caller's notifications_seen_at (213) and last_seen_at. */

let auth: any;
vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => auth,
  authError: (r: { status: number; error: string }) => new Response(JSON.stringify({ error: r.error }), { status: r.status }),
}));
const writes: Array<{ patch: Record<string, unknown>; id: unknown; guard?: string }> = [];
let dbError: unknown = null; // or (patch) => error
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: () => ({ update: (patch: Record<string, unknown>) => ({ eq: (_k: string, id: unknown) => ({ or: async (guard: string) => { writes.push({ patch, id, guard }); return { error: typeof dbError === 'function' ? dbError(patch) : dbError }; } }) }) }) }),
}));
const { POST } = await import('@/app/api/notifications/seen/route');
const post = (body?: unknown) => POST(new Request('http://x/api/notifications/seen', { method: 'POST', body: body ? JSON.stringify(body) : undefined }));

beforeEach(() => { writes.length = 0; dbError = null; auth = { ok: true, user: { athleteId: 'me' } }; });

describe('POST /api/notifications/seen', () => {
  it('stamps the caller\'s own last_seen_at → 200 { seenAt }', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    const { seenAt } = await res.json();
    expect(Number.isFinite(Date.parse(seenAt))).toBe(true);
    // Migration 213: the read cutoff first, then "last active" — both monotonic.
    expect(writes).toEqual([
      { patch: { notifications_seen_at: seenAt }, id: 'me', guard: `notifications_seen_at.is.null,notifications_seen_at.lt.${seenAt}` },
      { patch: { last_seen_at: seenAt }, id: 'me', guard: `last_seen_at.is.null,last_seen_at.lt.${seenAt}` },
    ]);
  });
  it('before migration 213 (column missing) it still stamps last_seen_at → 200', async () => {
    dbError = (patch: Record<string, unknown>) => ('notifications_seen_at' in patch ? { code: '42703' } : null);
    const res = await post();
    expect(res.status).toBe(200);
    expect(writes.map((w) => Object.keys(w.patch)[0])).toEqual(['notifications_seen_at', 'last_seen_at']);
  });
  it('ignores any athleteId in the body: identity is the session only', async () => {
    await post({ athleteId: 'someone-else' });
    expect([...new Set(writes.map((w) => w.id))]).toEqual(['me']);
  });
  it('no session → 401, nothing written', async () => {
    auth = { ok: false, status: 401, error: 'Authentication required' };
    expect((await post()).status).toBe(401);
    expect(writes).toEqual([]);
  });
  it('no athlete row → 403', async () => {
    auth = { ok: true, user: { athleteId: null } };
    expect((await post()).status).toBe(403);
    expect(writes).toEqual([]);
  });
  it('viewing as someone else → 204 and their last-seen is not moved', async () => {
    auth = { ok: true, user: { athleteId: 'them', viewingAsBy: 'admin@x' } };
    expect((await post()).status).toBe(204);
    expect(writes).toEqual([]);
  });
  it('only moves both stamps forward (guarded updates), and repeat calls are harmless', async () => {
    await post(); await post();
    expect(writes).toHaveLength(4);
    for (const w of writes) {
      const col = Object.keys(w.patch)[0];
      expect(w.guard).toMatch(new RegExp(`^${col}\\.is\\.null,${col}\\.lt\\.`));
    }
  });
  it('DB error → 500 with a generic message', async () => {
    dbError = { message: 'secret detail' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to mark seen' });
  });
});
