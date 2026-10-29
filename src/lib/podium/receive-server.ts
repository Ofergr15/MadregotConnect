import type { SupabaseClient } from '@supabase/supabase-js';
import { roundTotals, type PodiumProduct, type PodiumRound, budgetOf } from '@/lib/podium/model';
import { allocate, counted, overAllocated, shareOf, sumQty, type Share } from '@/lib/podium/receive';
import { loadOrders, loadProducts, loadReceived, type OrderRow } from '@/lib/podium/server';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;

export interface ReceiveView {
  ordered: Record<string, number>;
  received: Record<string, number>;
  recorded: boolean;
  shares: Record<string, Share & { manual: boolean; deliveredAt: string | null }>;
  over: string[];
  missingItems: number;
  missingValue: number;
}

/** Everything the receive/distribute screens show for one round. */
export async function receiveView(db: Db, round: PodiumRound, pre?: { orders?: OrderRow[]; products?: PodiumProduct[] }): Promise<ReceiveView> {
  const [orders, products] = await Promise.all([pre?.orders ?? loadOrders(db, round.id), pre?.products ?? loadProducts(db)]);
  const ordered = roundTotals(orders);
  const { received, recorded } = await loadReceived(db, round.id, ordered);
  const alloc = allocate(orders, received);
  const shares: ReceiveView['shares'] = {};
  for (const o of orders.filter(counted)) {
    // Each order against its own budget: a person's in the round, a group order's own (migration 175).
    shares[o.id] = { ...shareOf(o.items, alloc.get(o.id) ?? {}, products, budgetOf(round, o)), manual: !!o.allocation, deliveredAt: o.deliveredAt };
  }
  const byId = new Map(products.map((p) => [p.id, p]));
  let missingItems = 0; let missingValue = 0;
  for (const [id, q] of ordered) {
    const d = Math.max(0, q - (received[id] ?? 0));
    missingItems += d; missingValue += d * (byId.get(id)?.price ?? 0);
  }
  return {
    ordered: Object.fromEntries(ordered), received, recorded, shares, over: overAllocated(alloc, received),
    missingItems, missingValue: Math.round(missingValue * 100) / 100,
  };
}

export { sumQty };
