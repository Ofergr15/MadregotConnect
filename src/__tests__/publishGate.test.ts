import { beforeEach, describe, expect, it, vi } from 'vitest';

/** "מפרסם באישור" (Ofer 10-23): the publish gate's four answers. */
let user: Record<string, unknown>;
let grant: Record<string, unknown> | undefined;
const drafts: unknown[] = [];
vi.mock('@/lib/auth-session', () => ({ requireSession: async () => ({ ok: true, user }), authError: () => new Response(null, { status: 401 }) }));
vi.mock('@/lib/access/grants', async (orig) => ({ ...(await orig() as object), readGrants: async () => (grant ? { me: grant } : {}) }));
vi.mock('@/lib/access/drafts', () => ({ addDraft: async (_db: unknown, d: unknown) => { drafts.push(d); return { id: 'd1', title: 't' }; } }));
vi.mock('@/lib/push', () => ({ notifyAthlete: async () => ({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'owner', name: 'Guy' } }) }) }) }) }),
}));
const { publishGate } = await import('@/lib/access/publish-gate');
const req = () => new Request('http://x/api/admin/cheers', { method: 'POST', body: JSON.stringify({ text: 'כל הכבוד' }) });

beforeEach(() => { drafts.length = 0; grant = undefined; user = { athleteId: 'me', email: 'g@x', canApprove: false, isSuperUser: false, isStaff: false }; });

describe('publishGate', () => {
  it('the old rule still publishes', async () => {
    user.canApprove = true;
    expect((await publishGate(req(), 'cheers', '/api/admin/cheers', (u) => !!u.canApprove)).denied).toBeNull();
  });
  it('a publisher grant publishes', async () => {
    grant = { content: { cheers: 3 } };
    expect((await publishGate(req(), 'cheers', '/api/admin/cheers', () => false)).denied).toBeNull();
  });
  it('"for approval" keeps the request as a draft and answers 202', async () => {
    grant = { content: { cheers: 2 } };
    const g = await publishGate(req(), 'cheers', '/api/admin/cheers', () => false);
    expect(g.denied?.status).toBe(202);
    expect(drafts).toEqual([expect.objectContaining({ kind: 'cheers', path: '/api/admin/cheers', body: { text: 'כל הכבוד' }, byId: 'me' })]);
  });
  it('only seeing is refused', async () => {
    grant = { content: { cheers: 1 } };
    expect((await publishGate(req(), 'cheers', '/api/admin/cheers', () => false)).denied?.status).toBe(403);
    expect(drafts).toHaveLength(0);
  });
});
