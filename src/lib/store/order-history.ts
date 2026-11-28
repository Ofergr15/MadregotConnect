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
  reason?: string | null;
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
  /** Why a skip / back-step was allowed (migration 250); null on a normal step. */
  reason: string | null;
}

/** Newest first, in the API's shape. */
export function toHistory(rows: Array<{ from_status: string | null; to_status: string; changed_by: string | null; changed_by_name: string | null; changed_at: string; reason?: string | null }>): StatusEvent[] {
  return [...rows]
    .sort((a, b) => (b.changed_at ?? '').localeCompare(a.changed_at ?? ''))
    .map((r) => ({ from: r.from_status, to: r.to_status, by: { id: r.changed_by, name: r.changed_by_name }, at: r.changed_at, reason: r.reason ?? null }));
}

// ── Transition rules (round-4 task 84) ────────────────────────────────────────────
//
// The normal path is forward, one step at a time: pending_payment → paid → fulfilled, and an
// order not yet handed over may be cancelled. Anything else — skipping "paid" (handed over
// unpaid), undoing a step, reopening a cancelled order, cancelling after hand-over — is
// allowed only with a written reason, which goes on the audit row.

const NORMAL: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['fulfilled', 'cancelled'],
  fulfilled: [],
  cancelled: [],
};

export const REASON_MAX = 200;

export type TransitionCheck =
  | { ok: true; normal: boolean; reason: string | null }
  | { ok: false; error: 'reason_required' | 'reason_too_long' | 'unknown_from' };

export function cleanReason(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return t || null;
}

/** May an order move from → to, given an optional reason? A repeat (from === to) is a no-op. */
export function checkTransition(from: string | null, to: OrderStatus, rawReason: unknown): TransitionCheck {
  const reason = cleanReason(rawReason);
  if (reason && reason.length > REASON_MAX) return { ok: false, error: 'reason_too_long' };
  if (from === to) return { ok: true, normal: true, reason };
  if (!isOrderStatus(from)) return reason ? { ok: true, normal: false, reason } : { ok: false, error: 'unknown_from' };
  if (NORMAL[from].includes(to)) return { ok: true, normal: true, reason };
  return reason ? { ok: true, normal: false, reason } : { ok: false, error: 'reason_required' };
}

/** The statuses the UI may offer without asking for a reason. */
export function normalNext(from: string | null): readonly OrderStatus[] {
  return isOrderStatus(from) ? NORMAL[from] : [];
}

// ── The reason sheet (decision 28.11) ─────────────────────────────────────────────
// An exceptional move asks for its reason in an in-app bottom sheet (no window.prompt):
// a preset chip, or 'אחר' with free text. Submit stays disabled until this returns a reason.

export const REASON_OTHER = 'אחר';
export const REASON_PRESETS = ['החזר כספי', 'טעות בלחיצה', 'התשלום לא עבר', REASON_OTHER] as const;

/** Does this move need a reason before it is sent? A repeat or a normal step does not. */
export function needsReason(from: string | null, to: OrderStatus): boolean {
  return from !== to && !normalNext(from).includes(to);
}

/** The reason the sheet sends, or null while it has none: a preset as is, 'אחר' only with text. */
export function composeReason(chip: string | null, text: string): string | null {
  if (!chip || !(REASON_PRESETS as readonly string[]).includes(chip)) return null;
  const reason = chip === REASON_OTHER ? cleanReason(text) : chip;
  return reason && reason.length <= REASON_MAX ? reason : null;
}
