import { describe, expect, it, vi } from 'vitest';

/** Q24-1: /api/features/me is per caller with no Vary — it must never be stored (shared iPad). */
let denied: Response | null = null;
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => ({ denied, caller: { athleteId: 'a1', isStaff: false, isSuperUser: false, role: 'runner', roles: [] } }),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
vi.mock('@/lib/features/server', () => ({
  featureResolutions: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, { enabled: false }])),
}));

const { GET } = await import('@/app/api/features/me/route');

describe('GET /api/features/me caching', () => {
  it('answers no-store, never a max-age', async () => {
    denied = null;
    const cc = (await GET(new Request('https://x.test/api/features/me'))).headers.get('cache-control') || '';
    expect(cc).toContain('no-store');
    expect(cc).not.toMatch(/max-age/);
  });
  it('the denied answer is no-store too', async () => {
    denied = new Response(JSON.stringify({ error: 'x' }), { status: 401 });
    const r = await GET(new Request('https://x.test/api/features/me'));
    expect(r.status).toBe(401);
    expect(r.headers.get('cache-control')).toContain('no-store');
  });
});
