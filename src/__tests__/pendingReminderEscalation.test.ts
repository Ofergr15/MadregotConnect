import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The approvers' "still waiting" reminder escalates (2026-10-19): mornings for a
 * wait past a day; evenings, and by email, past two; it lands on the funnel's
 * approval step; and a request whose person is already approved rings nobody.
 */
let requests: Array<{ id: string; full_name: string | null; created_at: string; athlete_id: string | null }>;
let athletes: Array<{ id: string; name: string | null; approved: boolean | null }>;
const pushes: Array<{ url: string; body: string }> = [];
const digests: Array<{ count: number }> = [];

vi.mock('@/lib/notifications/staff', () => ({
  notifyStaff: async (o: { url: string; copy: (l: 'he') => { body: string } }) => { pushes.push({ url: o.url, body: o.copy('he').body }); return { sent: 1 }; },
}));
vi.mock('@/lib/email', () => ({ notifyAdminPendingDigest: async (p: { count: number }) => { digests.push(p); return { ok: true }; } }));

const NOW = new Date('2026-10-19T16:00:00Z');
const db = {
  from(table: string) {
    let cutoff = '';
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain, eq: () => chain,
      lte: (_c: string, v: string) => { cutoff = v; return chain; },
      order: async () => ({ data: requests.filter((r) => r.created_at <= cutoff), error: null }),
      in: async () => ({ data: athletes, error: null }),
    });
    void table;
    return chain;
  },
};
const ledger = () => { const fired = new Set<string>(); return { already: async (t: string) => fired.has(t), markFired: async (t: string) => { fired.add(t); } }; };
const { runPendingReminders, PENDING_REMINDER_URL } = await import('@/lib/onboarding/pending-reminder');

beforeEach(() => {
  pushes.length = 0; digests.length = 0;
  requests = [
    { id: 'r1', full_name: 'Omer Weisman', created_at: '2026-10-13T08:00:00Z', athlete_id: 'a1' },
    { id: 'r2', full_name: 'Yoav Shachaf', created_at: '2026-10-13T07:00:00Z', athlete_id: 'a2' },
    { id: 'r3', full_name: 'Noa Levi', created_at: '2026-10-18T10:00:00Z', athlete_id: null },
  ];
  athletes = [{ id: 'a1', name: 'Omer Weisman', approved: false }, { id: 'a2', name: 'Yoav Shachaf', approved: true }];
});

describe('the escalating approval reminder', () => {
  it('morning: everyone past a day, minus the already-approved, onto the funnel step', async () => {
    const n = await runPendingReminders(db as never, NOW, ledger());
    expect(n).toBe(2);
    expect(pushes[0].url).toBe(PENDING_REMINDER_URL);
    expect(pushes[0].body).toContain('Omer Weisman');
    expect(pushes[0].body).not.toContain('Yoav');
    expect(digests).toHaveLength(0);
  });

  it('evening: only waits past two days, and the approvers get the email too', async () => {
    const n = await runPendingReminders(db as never, NOW, ledger(), 'evening');
    expect(n).toBe(1);
    expect(pushes[0].body).not.toContain('Noa');
    expect(digests).toEqual([expect.objectContaining({ count: 1 })]);
  });
});
