import { beforeEach, describe, expect, it, vi } from 'vitest';
import { csvCell, unpaidCsv, unpaidRows } from '@/lib/finance/unpaid';
import type { FinanceInput } from '@/lib/finance/summary';
import type { PaymentBoard, PaymentRowView } from '@/lib/academy/payments';

// Task 188 — who hasn't paid, as a list and a CSV. Synthetic data only.

const now = new Date('2026-11-24T10:00:00Z');
const row = (o: Partial<PaymentRowView>): PaymentRowView => ({
  athleteId: 'a', name: 'שירה לוי', bandNumber: 1, coachId: 'c', coachName: 'יעל', state: 'paid', status: 'active',
  monthlyAmountIls: 600, paidAmountIls: null, paidSource: null, daysSinceLink: null, coachedForFree: false, needsAttention: false, note: null,
  ...o,
});
const board = (rows: PaymentRowView[]): PaymentBoard => ({
  period: '2026-11-01', rows, unpaid: [], paid: [],
  kpi: { trainees: rows.length, activeStandingOrders: 0, unpaid: 0, awaitingLink: 0, coachedForFree: 0, collectedIls: 0, expectedIls: 0 },
  freeRiders: [], needsAttention: 0,
});
const input = (o: Partial<FinanceInput> = {}): FinanceInput => ({ month: '2026-11', now, board: null, academyByMonth: [], storeOrders: [], podiumOrders: [], ...o });

describe('unpaidRows', () => {
  it('academy: every unsettled state in, paid and cancelled out', () => {
    const rows = unpaidRows(input({ board: board([
      row({ athleteId: 'p', state: 'paid' }),
      row({ athleteId: 'x', state: 'cancelled' }),
      row({ athleteId: 'u', state: 'unpaid', name: 'א' }),
      row({ athleteId: 'o', state: 'link_overdue', daysSinceLink: 9, name: 'ב' }),
      row({ athleteId: 'f', state: 'failed', name: 'ג' }),
      row({ athleteId: 'w', state: 'awaiting_link', name: 'ד' }),
      row({ athleteId: 'l', state: 'link_pending', daysSinceLink: 1, name: 'ה' }),
    ]) }));
    expect(rows.map((r) => r.id).sort()).toEqual(['f', 'l', 'o', 'u', 'w']);
    expect(rows[0]).toMatchObject({ id: 'o', days: 9, source: 'academy', coachName: 'יעל' });
  });
  it('store: only pending_payment orders, aged from the order', () => {
    const rows = unpaidRows(input({ storeOrders: [
      { id: 's1', athleteId: 'a1', name: 'דן', status: 'pending_payment', total: 120, createdAt: '2026-11-20T10:00:00Z' },
      { id: 's2', athleteId: 'a2', name: 'רון', status: 'paid', total: 90, createdAt: '2026-11-01T10:00:00Z' },
      { id: 's3', athleteId: 'a3', name: 'גל', status: 'fulfilled', total: 90, createdAt: '2026-11-01T10:00:00Z' },
    ] }));
    expect(rows).toEqual([expect.objectContaining({ source: 'store', id: 's1', amountIls: 120, days: 4, state: 'pending_payment' })]);
  });
  it('podium approvals are not unpaid', () => {
    const rows = unpaidRows(input({ podiumOrders: [{ id: 'p', athleteId: 'a', name: 'x', roundTitle: 'r', lockMonth: '2026-11', submitted: true, approval: 'pending', total: 500, budget: 300, updatedAt: '2026-11-20' }] }));
    expect(rows).toEqual([]);
  });
});

describe('CSV', () => {
  it('quotes, and defuses formulas in names', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
  });
  it('BOM + Hebrew header + one line per row', () => {
    const csv = unpaidCsv(unpaidRows(input({ board: board([row({ athleteId: 'u', state: 'unpaid', name: 'שירה, לוי' })]) })));
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('מקור,שם,מצב,סכום (₪),ימים,מאמן/ת,הערה');
    expect(lines[1]).toContain('"שירה, לוי"');
    expect(lines[1].startsWith('אקדמיה,')).toBe(true);
  });
});

// ── route ──
const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
let reads = 0;
const storeRows = [{ id: 's1', athlete_id: 'a1', status: 'pending_payment', total: 120, created_at: '2026-11-20T10:00:00Z' }];
class Q implements PromiseLike<{ data: unknown; error: unknown }> {
  constructor(private table: string) { reads += 1; }
  select() { return this; } eq() { return this; } in() { return this; } gte() { return this; } lt() { return this; } neq() { return this; }
  order() { return this; } maybeSingle() { return this; }
  then<A = { data: unknown; error: unknown }, B = never>(ok?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    const data = this.table === 'store_orders' ? storeRows : this.table === 'athletes' ? [{ id: 'a1', name: 'דן' }] : [];
    const error = this.table === 'academy_billing' ? { code: '42P01', message: 'relation does not exist' } : null;
    return Promise.resolve<{ data: unknown; error: unknown }>({ data, error }).then(ok, bad);
  }
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => new Q(t) }) }));

const { GET } = await import('@/app/api/admin/finance/unpaid/route');
const coach = { denied: null, caller: { athleteId: 'c1', role: 'coach', isSuperUser: false, isStaff: true } };
const admin = { denied: null, caller: { athleteId: 'm1', role: 'admin', isSuperUser: false, isStaff: true } };

describe('GET /api/admin/finance/unpaid', () => {
  beforeEach(() => { resolveVerifiedCaller.mockReset(); reads = 0; });
  it('a coach gets 403 before any read', async () => {
    resolveVerifiedCaller.mockResolvedValueOnce(coach);
    expect((await GET(new Request('http://x/api/admin/finance/unpaid'))).status).toBe(403);
    expect(reads).toBe(0);
  });
  it('a manager gets the list; academy degrades before 115', async () => {
    resolveVerifiedCaller.mockResolvedValueOnce(admin);
    const j = await (await GET(new Request('http://x/api/admin/finance/unpaid?month=2026-11'))).json();
    expect(j).toMatchObject({ month: '2026-11', academyTableMissing: true, count: 1, amountIls: 120 });
    expect(j.rows[0]).toMatchObject({ id: 's1', name: 'דן', source: 'store' });
  });
  it('format=csv is a download', async () => {
    resolveVerifiedCaller.mockResolvedValueOnce(admin);
    const res = await GET(new Request('http://x/api/admin/finance/unpaid?month=2026-11&format=csv'));
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(res.headers.get('content-disposition')).toContain('madregot-unpaid-2026-11.csv');
    expect(await res.text()).toContain('חנות,דן');
  });
});
