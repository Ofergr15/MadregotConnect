// Task 84: store order status transitions — forward one step (or cancel before hand-over) is
// free; a skip or back-step needs a reason, stored on the audit row (migration 250).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { checkTransition, normalNext } from '@/lib/store/order-history';

const user = { athleteId: 'staff-1', name: 'Dana Coach', isStaff: true };
vi.mock('@/lib/auth-session', () => ({ requireSession: async () => ({ ok: true, user }), authError: () => new Response(null, { status: 401 }) }));
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
const route = await import('@/app/api/admin/store/orders/[id]/route');
const history = await import('@/app/api/admin/store/orders/[id]/history/route');
const ctx = { params: Promise.resolve({ id: 'o1' }) };
const patch = (body: unknown) => route.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), ctx);

const EVENT_COLS = ['id', 'order_id', 'from_status', 'to_status', 'changed_by', 'changed_by_name', 'changed_at'];
function seed(status: string, withReason = true) {
  db = createMemoryDb({
    schema: {
      store_orders: ['id', 'athlete_id', 'status', 'total', 'created_at'],
      store_order_status_events: withReason ? [...EVENT_COLS, 'reason'] : EVENT_COLS,
    },
  });
  db.tables.store_orders.push({ id: 'o1', athlete_id: 'a1', status, total: 120, created_at: '2026-11-01T10:00:00Z' });
}
beforeEach(() => seed('pending_payment'));

describe('checkTransition', () => {
  it.each([
    ['pending_payment', 'paid'], ['paid', 'fulfilled'], ['pending_payment', 'cancelled'], ['paid', 'cancelled'], ['paid', 'paid'],
  ])('%s → %s is free', (from, to) => expect(checkTransition(from, to as never, undefined)).toMatchObject({ ok: true }));
  it.each([
    ['pending_payment', 'fulfilled'], ['paid', 'pending_payment'], ['fulfilled', 'paid'], ['fulfilled', 'cancelled'], ['cancelled', 'pending_payment'],
  ])('%s → %s needs a reason', (from, to) => {
    expect(checkTransition(from, to as never, '')).toEqual({ ok: false, error: 'reason_required' });
    expect(checkTransition(from, to as never, '  ')).toEqual({ ok: false, error: 'reason_required' });
    expect(checkTransition(from, to as never, 'שולם במזומן')).toEqual({ ok: true, normal: false, reason: 'שולם במזומן' });
  });
  it('a reason is cleaned (bidi controls, whitespace) and capped', () => {
    expect(checkTransition('paid', 'pending_payment', '‮ הוחזר \n')).toMatchObject({ reason: 'הוחזר' });
    expect(checkTransition('paid', 'pending_payment', 'x'.repeat(201))).toEqual({ ok: false, error: 'reason_too_long' });
  });
  it('normalNext offers only the free steps', () => {
    expect(normalNext('pending_payment')).toEqual(['paid', 'cancelled']);
    expect(normalNext('fulfilled')).toEqual([]);
  });
});

describe('PATCH enforces the rules', () => {
  it('a skip without a reason is 409, nothing changes, no audit row', async () => {
    const res = await patch({ status: 'fulfilled' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'reason_required', allowed: ['paid', 'cancelled'] });
    expect(db.tables.store_orders[0].status).toBe('pending_payment');
    expect(db.tables.store_order_status_events ?? []).toHaveLength(0);
  });
  it('a skip with a reason goes through and the reason is on the audit row', async () => {
    expect((await patch({ status: 'fulfilled', reason: 'נמסר, ישלם מחר' })).status).toBe(200);
    expect(db.tables.store_order_status_events[0]).toMatchObject({ from_status: 'pending_payment', to_status: 'fulfilled', reason: 'נמסר, ישלם מחר', changed_by: 'staff-1' });
  });
  it('a back-step needs a reason', async () => {
    seed('fulfilled');
    expect((await patch({ status: 'paid' })).status).toBe(409);
    expect((await patch({ status: 'paid', reason: 'נמסר בטעות' })).status).toBe(200);
  });
  it('one audit row per real change; a normal step stores reason null', async () => {
    await patch({ status: 'paid' });
    await patch({ status: 'fulfilled' });
    expect(db.tables.store_order_status_events.map((e) => [e.to_status, e.reason ?? null])).toEqual([['paid', null], ['fulfilled', null]]);
  });
  it('unknown order → 404', async () => {
    db.tables.store_orders.length = 0;
    expect((await patch({ status: 'paid' })).status).toBe(404);
  });
  it('before migration 250 the change and the audit row still land (reason to the log)', async () => {
    seed('pending_payment', false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await patch({ status: 'fulfilled', reason: 'במזומן' })).status).toBe(200);
    expect(db.tables.store_order_status_events).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('history returns the reason', async () => {
    await patch({ status: 'fulfilled', reason: 'במזומן' });
    const { history: h } = await (await history.GET(new Request('http://x'), ctx)).json();
    expect(h[0]).toMatchObject({ to: 'fulfilled', reason: 'במזומן' });
  });
});
