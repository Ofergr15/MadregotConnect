import { describe, expect, it, vi } from 'vitest';

// Feedback #70: the admin account showed "1/4 to complete" in its header. It is not a
// member (no watch, no kit, no runs), so its checklist could never finish. The route
// answers not-applicable for it, which hides the pill, the feed card and the tour.

let role = 'admin';
const reads: string[] = [];

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user: { athleteId: 'a1', role } }),
  authError: () => new Response('{}', { status: 401 }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      reads.push(table);
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain,
        single: () => Promise.resolve({ data: { id: 'a1' }, error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (r: (v: unknown) => unknown) => Promise.resolve({ count: 0, error: null }).then(r),
      };
      return chain;
    },
  }),
}));

const { GET } = await import('@/app/api/onboarding/route');
const get = async () => (await GET(new Request('https://example.test/api/onboarding'))).json();

describe('GET /api/onboarding for staff roles', () => {
  it('is not applicable to the admin account', async () => {
    role = 'admin'; reads.length = 0;
    expect(await get()).toEqual({ applicable: false });
    expect(reads).toHaveLength(0);
  });

  it('still scores a coach, sizes included', async () => {
    role = 'coach';
    const body = await get();
    expect(body.applicable).toBe(true);
    expect(body.tasks.map((t: { key: string }) => t.key)).toContain('sizes');
  });
});
