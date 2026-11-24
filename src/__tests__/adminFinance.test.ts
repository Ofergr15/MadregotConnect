import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildFinance, monthsEnding, REMINDABLE, type FinanceInput } from '@/lib/finance/summary';
import type { PaymentBoard, PaymentRowView } from '@/lib/academy/payments';

// כספים (design/b22/finance/mockup-v3.html) — synthetic data only.

const now = new Date('2026-11-24T10:00:00Z');
const row = (o: Partial<PaymentRowView>): PaymentRowView => ({
  athleteId: 'a', name: 'שירה לוי', bandNumber: 1, coachId: 'c', coachName: 'יעל', state: 'paid', status: 'active',
  monthlyAmountIls: 600, paidAmountIls: null, paidSource: null, daysSinceLink: null, coachedForFree: false, needsAttention: false, note: null,
  ...o,
} as PaymentRowView);
const board = (rows: PaymentRowView[], collected: number, expected: number): PaymentBoard => ({
  period: '2026-11-01', rows, unpaid: rows.filter((r) => r.state !== 'paid'), paid: rows.filter((r) => r.state === 'paid'),
  kpi: { trainees: rows.length, activeStandingOrders: 0, unpaid: 0, awaitingLink: 0, coachedForFree: 0, collectedIls: collected, expectedIls: expected },
  freeRiders: [], needsAttention: 0,
});
const base = (o: Partial<FinanceInput> = {}): FinanceInput => ({
  month: '2026-11', now, board: null, academyByMonth: [], storeOrders: [], podiumOrders: [], ...o,
});

describe('finance summary', () => {
  it('six months ending at the month, oldest first, across a year boundary', () => {
    expect(monthsEnding('2026-02')).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('collected = academy + paid store orders of the month + approved podium overage; trend and change vs last month', () => {
    const f = buildFinance(base({
      board: board([row({ state: 'paid' }), row({ athleteId: 'b', name: 'תום אורן', state: 'link_overdue', daysSinceLink: 5 })], 12600, 13200),
      academyByMonth: [{ month: '2026-10', collectedIls: 12000 }, { month: '2026-11', collectedIls: 12600 }],
      storeOrders: [
        { id: 's1aaaa', athleteId: 'x', name: 'אלון בן', status: 'fulfilled', total: 1000, createdAt: '2026-11-05T09:00:00Z' },
        { id: 's2bbbb', athleteId: 'y', name: 'יוסי מור', status: 'pending_payment', total: 210, createdAt: '2026-11-15T09:00:00Z' },
        { id: 's3cccc', athleteId: 'z', name: 'דנה כהן', status: 'paid', total: 480, createdAt: '2026-11-22T09:00:00Z' },
        { id: 's4dddd', athleteId: 'z', name: 'דנה כהן', status: 'fulfilled', total: 1420, createdAt: '2026-10-10T09:00:00Z' },
      ],
      podiumOrders: [
        { id: 'p1', athleteId: 'q', name: 'רוני שמש', roundTitle: 'נובמבר', lockMonth: '2026-11', submitted: true, approval: 'approved', total: 740, budget: 600, updatedAt: '2026-11-20T09:00:00Z' },
        { id: 'p2', athleteId: 'r', name: 'עידו גל', roundTitle: 'נובמבר', lockMonth: '2026-11', submitted: true, approval: 'pending', total: 700, budget: 600, updatedAt: '2026-11-22T09:00:00Z' },
      ],
    }));
    expect(f.streams.academy.collectedIls).toBe(12600);
    expect(f.streams.store).toEqual({ collectedIls: 1480, paidOrders: 2 });
    expect(f.streams.podium.collectedIls).toBe(140);
    expect(f.streams.podium.exceptions).toBe(2);
    expect(f.collectedIls).toBe(12600 + 1480 + 140);
    expect(f.trend.map((t) => t.month)).toHaveLength(6);
    expect(f.trend[4]).toEqual({ month: '2026-10', collectedIls: 12000 + 1420 });
    expect(f.changePct).toBe(Math.round(((14220 - 13420) / 13420) * 100));
    // expected = academy 13200 + store paid 1480 + owed 210 + podium approved 140 + pending 100
    expect(f.expectedIls).toBe(13200 + 1480 + 210 + 140 + 100);
    expect(f.missingIls).toBe(f.expectedIls - f.collectedIls);
  });

  it('לטפל: grouped, oldest first, stale after 3 days, names cut to first + initial', () => {
    const f = buildFinance(base({
      board: board([row({ athleteId: 'a1', state: 'link_overdue', daysSinceLink: 5 }), row({ athleteId: 'a2', name: 'תום אורן', state: 'link_pending', daysSinceLink: 2 })], 0, 1200),
      storeOrders: [
        { id: 'u1', athleteId: 'x', name: 'אלון בן', status: 'pending_payment', total: 210, createdAt: '2026-11-15T09:00:00Z' },
        { id: 'd1', athleteId: 'y', name: 'יוסי מור', status: 'paid', total: 100, createdAt: '2026-11-22T09:00:00Z' },
      ],
    }));
    expect(f.todo.map((g) => g.kind)).toEqual(['store_unpaid', 'go_links', 'store_undelivered']);
    const go = f.todo.find((g) => g.kind === 'go_links')!;
    expect(go.count).toBe(2);
    expect(go.amountIls).toBe(1200);
    expect(go.oldestDays).toBe(5);
    expect(go.stale).toBe(true);
    expect(go.items[0].remindable).toBe(true);
    expect(go.subtitle).toBe('שירה ל׳, תום א׳');
    expect(f.todo.find((g) => g.kind === 'store_undelivered')!.stale).toBe(false);
    expect(f.todoCount).toBe(4);
    expect(f.allClosed).toBe(false);
  });

  it('a closed month: nothing to do, expected equals collected', () => {
    const f = buildFinance(base({ board: board([row({})], 600, 600), academyByMonth: [{ month: '2026-11', collectedIls: 600 }] }));
    expect(f.allClosed).toBe(true);
    expect(f.todo).toEqual([]);
    expect(f.missingIls).toBe(0);
  });

  it('no academy table: the stream says so, the rest still adds up', () => {
    const f = buildFinance(base({ storeOrders: [{ id: 'x', athleteId: 'x', name: 'א', status: 'paid', total: 50, createdAt: '2026-11-02T09:00:00Z' }] }));
    expect(f.streams.academy.tableMissing).toBe(true);
    expect(f.collectedIls).toBe(50);
  });

  it('a reminder never goes out for a paid month or a cancelled order', () => {
    expect(REMINDABLE.has('paid')).toBe(false);
    expect(REMINDABLE.has('cancelled')).toBe(false);
    for (const s of ['unpaid', 'link_pending', 'link_overdue', 'awaiting_link', 'failed']) expect(REMINDABLE.has(s)).toBe(true);
  });
});

// ── Gates: manager only, both routes ──
const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
const notifyAthlete = vi.fn(async (_o: unknown) => ({ subscriptions: 1, delivered: 1 }));
vi.mock('@/lib/push', () => ({ notifyAthlete: (o: unknown) => notifyAthlete(o) }));

class Q implements PromiseLike<{ data: unknown; error: unknown }> {
  constructor(private rows: unknown[] = []) {}
  select() { return this; } eq() { return this; } in() { return this; } gte() { return this; } lt() { return this; } neq() { return this; }
  order() { return this; } maybeSingle() { return this; }
  then<A = { data: unknown; error: unknown }, B = never>(
    ok?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    bad?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve<{ data: unknown; error: unknown }>({ data: this.rows, error: null }).then(ok, bad);
  }
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: () => new Q() }) }));

describe('finance routes are manager-only', () => {
  beforeEach(() => { resolveVerifiedCaller.mockReset(); notifyAthlete.mockClear(); });
  const coach = { denied: null, caller: { athleteId: 'c1', role: 'coach', isSuperUser: false, isStaff: true } };
  const admin = { denied: null, caller: { athleteId: 'm1', role: 'admin', isSuperUser: false, isStaff: true } };

  it('GET: a coach (staff for the store and podium) still gets 403; a manager gets the summary', async () => {
    const { GET } = await import('@/app/api/admin/finance/route');
    resolveVerifiedCaller.mockResolvedValueOnce(coach);
    expect((await GET(new Request('http://x/api/admin/finance'))).status).toBe(403);
    resolveVerifiedCaller.mockResolvedValueOnce(admin);
    const res = await GET(new Request('http://x/api/admin/finance?month=2026-11'));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.month).toBe('2026-11');
    expect(j.trend).toHaveLength(6);
  });

  it('POST remind: coach 403, no athlete 400, not a trainee 404 — and nothing is sent', async () => {
    const { POST } = await import('@/app/api/admin/finance/remind/route');
    const post = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) });
    resolveVerifiedCaller.mockResolvedValueOnce(coach);
    expect((await POST(post({ athleteId: 'a' }))).status).toBe(403);
    resolveVerifiedCaller.mockResolvedValueOnce(admin);
    expect((await POST(post({}))).status).toBe(400);
    resolveVerifiedCaller.mockResolvedValueOnce(admin);
    expect((await POST(post({ athleteId: 'nobody' }))).status).toBe(404);
    expect(notifyAthlete).not.toHaveBeenCalled();
  });
});
