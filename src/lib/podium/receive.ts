/**
 * הזמנת פודיום, after the goods arrive (Ofer 10-26, mockup ~/.cache/madregot/mockups/podium-receive):
 * the admin records how many of each product came, the app splits it between the runners, and
 * each runner is told what they got when the admin marks them "נמסר".
 *
 * Short products go FIRST TO SEND, FIRST SERVED (Ofer). A share the admin set by hand is taken
 * out of the stock first; the automatic split shares what is left among everyone else.
 * The money is recomputed from what a runner actually gets: over the budget → they transfer that.
 */
import { orderTotal, type PodiumOrder, type PodiumProduct } from '@/lib/podium/model';

export type Qty = Record<string, number>;

export interface AllocOrder extends Pick<PodiumOrder, 'id' | 'items' | 'submittedAt' | 'approval'> {
  /** The admin's hand-set share, or null for the automatic one. */
  allocation: Qty | null;
}

/** Orders that take part: sent and not rejected. */
export const counted = <T extends Pick<PodiumOrder, 'submittedAt' | 'approval'>>(o: T) => !!o.submittedAt && o.approval !== 'rejected';

/** order id → product → how many they get. */
export function allocate(orders: AllocOrder[], received: Qty): Map<string, Qty> {
  const left: Qty = { ...received };
  const out = new Map<string, Qty>();
  const live = orders.filter(counted);
  for (const o of live.filter((x) => x.allocation)) {
    const a: Qty = {};
    for (const [id, q] of Object.entries(o.allocation!)) if (q > 0) { a[id] = q; left[id] = (left[id] ?? 0) - q; }
    out.set(o.id, a);
  }
  const queue = live.filter((x) => !x.allocation).sort((a, b) => (a.submittedAt! < b.submittedAt! ? -1 : a.submittedAt! > b.submittedAt! ? 1 : a.id < b.id ? -1 : 1));
  for (const o of queue) {
    const a: Qty = {};
    for (const [id, want] of Object.entries(o.items)) {
      const give = Math.max(0, Math.min(want, left[id] ?? 0));
      if (give > 0) { a[id] = give; left[id] = (left[id] ?? 0) - give; }
    }
    out.set(o.id, a);
  }
  return out;
}

/** What is missing from what was ordered: product → count. */
export function missing(ordered: Qty, got: Qty): Qty {
  const m: Qty = {};
  for (const [id, q] of Object.entries(ordered)) { const d = q - (got[id] ?? 0); if (d > 0) m[id] = d; }
  return m;
}

export const sumQty = (q: Qty) => Object.values(q).reduce((s, n) => s + (n > 0 ? n : 0), 0);

export interface Share {
  got: Qty; missing: Qty;
  orderedValue: number; gotValue: number; missingValue: number;
  /** What the runner transfers, recomputed on what they got (0 within the budget). */
  owes: number;
}

export function shareOf(items: Qty, got: Qty, products: PodiumProduct[], budget: number): Share {
  const m = missing(items, got);
  const orderedValue = orderTotal(items, products);
  const gotValue = orderTotal(got, products);
  return { got, missing: m, orderedValue, gotValue, missingValue: Math.round((orderedValue - gotValue) * 100) / 100, owes: Math.max(0, Math.round((gotValue - budget) * 100) / 100) };
}

/** Over-handed: a product whose shares add up to more than arrived (only hand-set shares can do it). */
export function overAllocated(alloc: Map<string, Qty>, received: Qty): string[] {
  const used: Qty = {};
  for (const a of alloc.values()) for (const [id, q] of Object.entries(a)) used[id] = (used[id] ?? 0) + q;
  return Object.keys(used).filter((id) => used[id] > (received[id] ?? 0));
}

const cell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** The packing list: one line per runner per product they get, with what's missing. */
export function packingCsv(rows: Array<{ name: string; items: Qty; got: Qty }>, products: PodiumProduct[]): string {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = [['שם', 'מוצר', 'ברקוד', 'הוזמן', 'מקבל', 'חסר'].join(',')];
  for (const r of rows) {
    for (const [id, q] of Object.entries(r.items)) {
      const p = byId.get(id); if (!p) continue;
      const g = r.got[id] ?? 0;
      lines.push([r.name, p.name, p.barcode, q, g, q - g].map(cell).join(','));
    }
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
