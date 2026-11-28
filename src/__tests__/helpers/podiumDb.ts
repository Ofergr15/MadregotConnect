import { createMemoryDb } from './memory-db';

/**
 * A memory db with the podium tables. The memory db has no one-to-many embed, so
 * `podium_orders` reads that ask for `podium_order_items(product_id, quantity)` are answered
 * with `*` and the lines attached here, the way PostgREST nests them.
 */
export function podiumDb() {
  let seq = 0;
  const mem = createMemoryDb({
    schema: {
      podium_products: ['id', 'sku', 'barcode', 'name', 'dept', 'url', 'image_url', 'price', 'regular_price', 'deal', 'hidden', 'unavailable', 'checked_at', 'sort'],
      podium_rounds: ['id', 'title', 'audience', 'audience_ids', 'created_by', 'opens_at', 'locks_at', 'budget', 'sent_at', 'received_at', 'auto_notify', 'notify_title', 'notify_body', 'notified_open_ids', 'notified_remind_at', 'notified_lock_at', 'budgets', 'expected_count'],
      podium_orders: ['id', 'round_id', 'athlete_id', 'label', 'budget', 'submitted_at', 'approval', 'updated_at', 'approved_total', 'updated_by', 'allocation', 'delivered_at'],
      podium_order_items: ['order_id', 'product_id', 'quantity'],
      athletes: ['id', 'name', 'avatar_url', 'role', 'is_core_runner', 'is_super_user', 'status'],
      podium_received: ['round_id', 'product_id', 'quantity'],
    },
    defaults: { podium_orders: () => ({ id: `ord-${++seq}` }) },
  });
  const client = {
    from(table: string) {
      const q = mem.client.from(table);
      if (table !== 'podium_orders') return q;
      const select = q.select.bind(q);
      q.select = (cols?: string) => {
        if (!cols?.includes('podium_order_items(')) return select(cols);
        const b = select('*');
        const then = b.then.bind(b);
        b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => then((res: { data: unknown; error: unknown }) => {
          const attach = (o: Record<string, unknown>) => ({ ...o, podium_order_items: mem.tables.podium_order_items.filter((i) => i.order_id === o.id) });
          const data = Array.isArray(res.data) ? res.data.map(attach) : res.data ? attach(res.data as Record<string, unknown>) : res.data;
          return ok({ ...res, data });
        }, bad);
        return b;
      };
      return q;
    },
  };
  mem.tables.podium_products.push(
    { id: 'p1', sku: 1, barcode: '111', name: 'Gel', dept: 'nutrition', url: null, image_url: null, price: 8, regular_price: 10, deal: null, hidden: false, unavailable: false, checked_at: null, sort: 2 },
    { id: 'p2', sku: 2, barcode: '222', name: 'Socks', dept: 'gear', url: 'https://shop/p2', image_url: null, price: 30, regular_price: null, deal: null, hidden: false, unavailable: false, checked_at: null, sort: 1 },
    { id: 'p3', sku: 3, barcode: '333', name: 'Gone', dept: 'gear', url: null, image_url: null, price: 5, regular_price: null, deal: null, hidden: false, unavailable: true, checked_at: null, sort: 3 },
  );
  const round = (over: Record<string, unknown> = {}) => {
    const r = { id: 'r1', title: 'Nov', audience: 'core', audience_ids: [], created_by: 'admin', opens_at: '2026-11-01T00:00:00Z', locks_at: '2026-11-10T00:00:00Z', budget: '150', sent_at: null, received_at: null, auto_notify: null, notify_title: null, notify_body: null, notified_open_ids: ['a1'], notified_remind_at: null, notified_lock_at: null, budgets: { a1: '200', bad: 'x' }, expected_count: '15', ...over };
    mem.tables.podium_rounds.push(r);
    return r;
  };
  return { client: client as never, tables: mem.tables, round };
}
