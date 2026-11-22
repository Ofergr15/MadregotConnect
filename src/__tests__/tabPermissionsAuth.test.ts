import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * GET /api/admin/tab-permissions used to answer anyone on the internet. It is
 * only read from inside the signed-in shell (Header, BottomTabBar, Settings,
 * the native Access screen), all of which send the bearer — so it is now
 * member-gated through resolveVerifiedCaller.
 */
let denied: Response | null = null;
let reads = 0;

vi.mock('@/lib/auth/self-or-staff', () => ({
  requireMember: async () => denied,
}));
vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: false }),
  authError: () => new Response('unauthorized', { status: 401 }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const q: any = { select: () => q, order: () => q, then: (r: any) => { reads += 1; return Promise.resolve({ data: [{ role: 'runner', tab: 'feed', enabled: true }], error: null }).then(r); } };
      return q;
    },
  }),
}));

const req = () => new Request('https://madregot.app/api/admin/tab-permissions');

beforeEach(() => { denied = null; reads = 0; vi.resetModules(); });

describe('GET /api/admin/tab-permissions — auth', () => {
  it('refuses a caller with no verified session, without touching the DB', async () => {
    denied = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { GET } = await import('@/app/api/admin/tab-permissions/route');
    const res = await GET(req() as any);
    expect(res.status).toBe(401);
    expect(reads).toBe(0);
  });
  it('refuses even when the memo is warm', async () => {
    const { GET } = await import('@/app/api/admin/tab-permissions/route');
    expect((await GET(req() as any)).status).toBe(200);
    denied = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    expect((await GET(req() as any)).status).toBe(401);
  });
  it('answers a verified member', async () => {
    const { GET } = await import('@/app/api/admin/tab-permissions/route');
    const body = await (await GET(req() as any)).json();
    expect(body.permissions).toHaveLength(1);
  });
});
