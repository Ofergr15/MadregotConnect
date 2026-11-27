// Store order status history (night task 56, migration 231). Pure helpers; the
// routes under /api/admin/store/orders do the reads and writes.

export const ORDER_STATUSES = ['pending_payment', 'paid', 'fulfilled', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);
}

export interface StatusEventRow {
  order_id: string;
  from_status: string | null;
  to_status: OrderStatus;
  changed_by: string | null;
  changed_by_name: string | null;
}

/** The history row for one change, or null when nothing changed (a repeat PATCH is not an event). */
export function statusEvent(
  orderId: string, from: string | null, to: OrderStatus, actor: { athleteId: string | null; name: string | null },
): StatusEventRow | null {
  if (from === to) return null;
  return { order_id: orderId, from_status: from, to_status: to, changed_by: actor.athleteId, changed_by_name: actor.name || null };
}

export interface StatusEvent {
  from: string | null;
  to: string;
  by: { id: string | null; name: string | null };
  at: string;
}

/** Newest first, in the API's shape. */
export function toHistory(rows: Array<{ from_status: string | null; to_status: string; changed_by: string | null; changed_by_name: string | null; changed_at: string }>): StatusEvent[] {
  return [...rows]
    .sort((a, b) => (b.changed_at ?? '').localeCompare(a.changed_at ?? ''))
    .map((r) => ({ from: r.from_status, to: r.to_status, by: { id: r.changed_by, name: r.changed_by_name }, at: r.changed_at }));
}
