import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/email', () => ({ notifyJoinReminder: vi.fn(async () => ({ ok: true })) }));
import { runJoinReminders } from '@/lib/onboarding/join-reminder';
import { notifyJoinReminder } from '@/lib/email';

const DAY = 86_400_000;
function db(approvedDaysAgo: number, now: Date) {
  const req = [{ athlete_id: 'a1', approved_by: 'x', approved_at: new Date(now.getTime() - approvedDaysAgo * DAY).toISOString() }];
  const ath = [{ id: 'a1', email: 'chen@example.com', status: 'invited', last_seen_at: null, invite_token: 'tok', group_id: null }];
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'not', 'lte', 'gte', 'in']) c[k] = () => c;
    c.then = (r: (v: { data: unknown[]; error: null }) => unknown) => r({ data: rows, error: null });
    return c;
  };
  return { from: (t: string) => chain(t === 'signup_requests' ? req : ath) } as never;
}
function ledger(fired: string[]) {
  return { already: async (t: string) => fired.includes(t), markFired: async (t: string) => { fired.push(t); } };
}

/** The approved member who never came in: day 2, then once more on day 5, then quiet. */
describe('join reminders', () => {
  const now = new Date('2026-10-20T07:00:00Z');
  it('day 2: the first', async () => {
    const fired: string[] = [];
    expect(await runJoinReminders(db(2, now), now, ledger(fired))).toBe(1);
    expect(fired).toEqual(['joinReminder:a1']);
  });
  it('day 3: nothing more yet', async () => {
    expect(await runJoinReminders(db(3, now), now, ledger(['joinReminder:a1']))).toBe(0);
  });
  it('day 5: the second, once', async () => {
    const fired = ['joinReminder:a1'];
    expect(await runJoinReminders(db(5, now), now, ledger(fired))).toBe(1);
    expect(fired).toContain('joinReminder2:a1');
    expect(await runJoinReminders(db(6, now), now, ledger(fired))).toBe(0);
    expect(notifyJoinReminder).toHaveBeenCalled();
  });
});
