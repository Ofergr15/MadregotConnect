import { describe, expect, it, vi } from 'vitest';

// The academy applicant alert reaches the managers AND the owner's own account — by its
// address, so the operator account (also a super user) is not added a second time.
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const q: any = {
        select: () => q,
        contains: async () => ({ data: [{ id: 'eldar' }], error: null }),
        eq: async (c: string, v: string) => ({ data: c === 'email' && v === 'grosfeldofer@gmail.com' ? [{ id: 'ofer' }] : [], error: null }),
      };
      return q;
    },
  }),
}));
vi.mock('@/lib/push', () => ({ localesForAthletes: vi.fn(), persistNotifications: vi.fn(), sendPushLocalized: vi.fn(), subscriptionsForAthletes: vi.fn() }));

describe('academyManagerIds', () => {
  it('is the academy managers plus the owner, not every super-user row', async () => {
    const { academyManagerIds } = await import('@/lib/notifications/staff');
    await expect(academyManagerIds()).resolves.toEqual(['eldar', 'ofer']);
  });
});
