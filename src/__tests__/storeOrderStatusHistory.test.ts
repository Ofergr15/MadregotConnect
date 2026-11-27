import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { statusEvent, toHistory, isOrderStatus } from '@/lib/store/order-history';

let user: { athleteId: string | null; name: string; isStaff: boolean } = { athleteId: 'staff-1', name: 'Dana Coach', isStaff: true };
vi.mock('@/lib/auth-session', () => ({ requireSession: async () => ({ ok: true, user }), authError: () => new Response(null, { status: 401 }) }));
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const route = await import('@/app/api/admin/store/orders/[id]/route');
const history = await import('@/app/api/admin/store/orders/[id]/history/route');
const ctx = { params: Promise.resolve({ id: 'o1' }) };
const patch = (body: unknown) => route.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), ctx);
const get = () => history.GET(new Request('http://x'), ctx);

function seed(migrated = true) {
  db = createMemoryDb({
    schema: {
      store_orders: ['id', 'athlete_id', 'status', 'total', 'contact_phone', 'notes', 'created_at'],
      ...(migrated ? { store_order_status_events: ['id', 'order_id', 'from_status', 'to_status', 'changed_by', 'changed_by_name', 'changed_at'] } : {}),
    },
  });
  db.tables.store_orders.push({ id: 'o1', athlete_id: 'a1', status: 'pending_payment', total: 120, created_at: '2026-11-01T10:00:00Z' });
}

beforeEach(() => { seed(); user = { athleteId: 'staff-1', name: 'Dana Coach', isStaff: true }; });

describe('order history helpers', () => {
  it('no event for a no-op change', () => {
    expect(statusEvent('o1', 'paid', 'paid', { athleteId: 'x', name: 'y' })).toBeNull();
  });
  it('validates statuses', () => {
    expect(isOrderStatus('paid')).toBe(true);
    expect(isOrderStatus('shipped')).toBe(false);
  });
  it('history is newest first', () => {
    const h = toHistory([
      { from_status: null, to_status: 'paid', changed_by: 'a', changed_by_name: 'A', changed_at: '2026-11-01T00:00:00Z' },
      { from_status: 'paid', to_status: 'fulfilled', changed_by: 'b', changed_by_name: 'B', changed_at: '2026-11-02T00:00:00Z' },
    ]);
    expect(h.map((e) => e.to)).toEqual(['fulfilled', 'paid']);
  });
});

describe('PATCH /api/admin/store/orders/[id] records who changed what', () => {
  it('writes the status and a history row from the session, not the body', async () => {
    const res = await patch({ status: 'paid', changedBy: 'someone-else' });
    expect(res.status).toBe(200);
    expect(db.tables.store_orders[0].status).toBe('paid');
    expect(db.tables.store_order_status_events).toHaveLength(1);
    expect(db.tables.store_order_status_events[0]).toMatchObject({
      order_id: 'o1', from_status: 'pending_payment', to_status: 'paid', changed_by: 'staff-1', changed_by_name: 'Dana Coach',
    });
  });
  it('a repeat of the same status adds no event', async () => {
    await patch({ status: 'paid' });
    await patch({ status: 'paid' });
    expect(db.tables.store_order_status_events).toHaveLength(1);
  });
  it('still updates the status before migration 231', async () => {
    seed(false);
    expect((await patch({ status: 'fulfilled' })).status).toBe(200);
    expect(db.tables.store_orders[0].status).toBe('fulfilled');
  });
  it('rejects a non-staff caller and a bad status', async () => {
    expect((await patch({ status: 'shipped' })).status).toBe(400);
    user = { athleteId: 'r1', name: 'Runner', isStaff: false };
    expect((await patch({ status: 'paid' })).status).toBe(403);
  });
});

describe('GET …/history', () => {
  it('staff read the history', async () => {
    await patch({ status: 'paid' });
    await patch({ status: 'fulfilled' });
    const res = await get();
    expect(res.status).toBe(200);
    const { history: h } = await res.json();
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ by: { id: 'staff-1', name: 'Dana Coach' } });
  });
  it('is staff-only', async () => {
    user = { athleteId: 'r1', name: 'Runner', isStaff: false };
    expect((await get()).status).toBe(403);
  });
  it('503 before the migration', async () => {
    seed(false);
    expect((await get()).status).toBe(503);
  });
});
