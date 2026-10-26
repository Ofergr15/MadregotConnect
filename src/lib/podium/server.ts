import type { SupabaseClient } from '@supabase/supabase-js';
import {
  approvalAfter, audienceAllows, cleanItems, orderTotal,
  type Approval, type Audience, type PodiumOrder, type PodiumProduct, type PodiumRound, type Viewer,
} from '@/lib/podium/model';
import { isCoreRunner } from '@/lib/core-runner';
import { isStaffRole } from '@/lib/auth/self-or-staff';
import { findByBarcode, readItem, type SiteProduct } from '@/lib/podium/site';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;

const toProduct = (r: any): PodiumProduct => ({
  id: r.id, sku: r.sku, barcode: r.barcode, name: r.name, dept: r.dept, url: r.url ?? null, imageUrl: r.image_url ?? null,
  price: r.price == null ? null : Number(r.price), regularPrice: r.regular_price == null ? null : Number(r.regular_price),
  deal: r.deal ?? null, hidden: !!r.hidden, checkedAt: r.checked_at ?? null, sort: r.sort ?? 0,
});
export const toRound = (r: any): PodiumRound => ({
  id: r.id, title: r.title, audience: (r.audience ?? 'core') as Audience, audienceIds: r.audience_ids ?? [], createdBy: r.created_by ?? null, opensAt: r.opens_at, locksAt: r.locks_at, budget: Number(r.budget), sentAt: r.sent_at ?? null, receivedAt: r.received_at ?? null,
});

export async function loadProducts(db: Db): Promise<PodiumProduct[]> {
  const { data, error } = await db.from('podium_products').select('*').order('sort');
  if (error) throw error;
  return (data ?? []).map(toProduct);
}

/** The round this person sees: the newest one open to them that hasn't been sent, else the newest open to them. */
export async function currentRound(db: Db, viewer: Viewer): Promise<PodiumRound | null> {
  const { data, error } = await db.from('podium_rounds').select('*').order('opens_at', { ascending: false }).limit(10);
  if (error) throw error;
  const rows = (data ?? []).map(toRound).filter((r) => audienceAllows(r, viewer));
  return rows.find((r) => !r.sentAt) ?? rows[0] ?? null;
}

export async function loadRound(db: Db, id: string): Promise<PodiumRound | null> {
  const { data } = await db.from('podium_rounds').select('*').eq('id', id).maybeSingle();
  return data ? toRound(data) : null;
}

export async function listRounds(db: Db): Promise<PodiumRound[]> {
  const { data, error } = await db.from('podium_rounds').select('*').order('opens_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toRound);
}

export interface OrderRow extends PodiumOrder {
  approvedTotal: number | null; updatedBy: string | null;
  /** After receiving (lib/podium/receive): the admin's hand-set share, and when it was handed over. */
  allocation: Record<string, number> | null; deliveredAt: string | null;
}

const toOrder = (r: any): OrderRow => ({
  id: r.id, roundId: r.round_id, athleteId: r.athlete_id, submittedAt: r.submitted_at ?? null, approval: r.approval as Approval,
  updatedAt: r.updated_at, approvedTotal: r.approved_total == null ? null : Number(r.approved_total), updatedBy: r.updated_by ?? null,
  allocation: r.allocation ?? null, deliveredAt: r.delivered_at ?? null,
  items: Object.fromEntries(((r.podium_order_items ?? []) as Array<{ product_id: string; quantity: number }>).map((i) => [i.product_id, i.quantity])),
});

export async function loadOrders(db: Db, roundId: string): Promise<OrderRow[]> {
  const { data, error } = await db.from('podium_orders').select('*, podium_order_items(product_id, quantity)').eq('round_id', roundId);
  if (error) throw error;
  return (data ?? []).map(toOrder);
}

export async function loadOrder(db: Db, roundId: string, athleteId: string): Promise<OrderRow | null> {
  const { data } = await db.from('podium_orders').select('*, podium_order_items(product_id, quantity)').eq('round_id', roundId).eq('athlete_id', athleteId).maybeSingle();
  return data ? toOrder(data) : null;
}

export async function loadOrderById(db: Db, id: string): Promise<OrderRow | null> {
  const { data } = await db.from('podium_orders').select('*, podium_order_items(product_id, quantity)').eq('id', id).maybeSingle();
  return data ? toOrder(data) : null;
}

/**
 * Write an order's quantities (replacing them) and recompute its approval. `submit` stamps
 * the send; an edit after the send keeps it sent. Returns the saved row.
 */
export async function saveOrder(db: Db, opts: {
  round: PodiumRound; athleteId: string; items: unknown; products: PodiumProduct[]; by: string | null;
  submit?: boolean; admin?: boolean; unsubmit?: boolean;
}): Promise<OrderRow> {
  const items = cleanItems(opts.items, opts.products, { allowUnorderable: opts.admin });
  const total = orderTotal(items, opts.products);
  const prev = await loadOrder(db, opts.round.id, opts.athleteId);
  const prevTotal = prev ? orderTotal(prev.items, opts.products) : 0;
  // An admin's change keeps a yes it already gave; a runner's bigger total asks again.
  const approval = opts.admin && prev?.approval === 'approved' ? 'approved' : approvalAfter(total, opts.round.budget, prev?.approval ?? 'none', prev?.approvedTotal ?? prevTotal);
  const now = new Date().toISOString();
  const row = {
    round_id: opts.round.id, athlete_id: opts.athleteId, approval, updated_at: now, updated_by: opts.by,
    submitted_at: opts.submit ? now : opts.unsubmit ? null : prev?.submittedAt ?? null,
    ...(approval === 'approved' && opts.admin ? { approved_total: total } : {}),
  };
  const { data, error } = prev
    ? await db.from('podium_orders').update(row).eq('id', prev.id).select('id').single()
    : await db.from('podium_orders').insert(row).select('id').single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  const { error: delErr } = await db.from('podium_order_items').delete().eq('order_id', id);
  if (delErr) throw delErr;
  const lines = Object.entries(items).map(([product_id, quantity]) => ({ order_id: id, product_id, quantity }));
  if (lines.length) {
    const { error: insErr } = await db.from('podium_order_items').insert(lines);
    if (insErr) throw insErr;
  }
  return (await loadOrderById(db, id))!;
}

export interface Member { id: string; name: string; avatarUrl: string | null; isCore: boolean; isStaff: boolean }

/** Every member who could be in a round's audience (removed ones out). */
export async function members(db: Db): Promise<Member[]> {
  const { data } = await db.from('athletes').select('id, name, avatar_url, role, is_core_runner, is_super_user, status');
  return ((data ?? []) as any[])
    .filter((a) => a.status !== 'removed')
    .map((a) => ({ id: a.id, name: a.name ?? '', avatarUrl: a.avatar_url ?? null, isCore: isCoreRunner(a), isStaff: isStaffRole(a.role) || a.is_super_user === true }));
}

/** The people a round is for — who gets "it's open", the reminder, and is counted as "not ordered yet". */
export async function audienceOf(db: Db, round: PodiumRound): Promise<Member[]> {
  return (await members(db)).filter((m) => audienceAllows(round, { athleteId: m.id, isCore: m.isCore, isStaff: m.isStaff }));
}

const siteRow = (s: SiteProduct) => ({
  url: s.url, image_url: s.imageUrl, price: s.price, regular_price: s.regularPrice, deal: s.deal, checked_at: new Date().toISOString(),
});

/**
 * "בדיקת מחירים ומבצעים מול האתר": every product again, by its saved link when it has one
 * (a link the admin pasted wins over the barcode search), else by barcode. A product the
 * site no longer has keeps its last values and is reported. Four at a time.
 */
export async function checkPrices(db: Db, products: PodiumProduct[]): Promise<{ updated: number; missing: string[]; changed: Array<{ name: string; from: number | null; to: number | null }> }> {
  let updated = 0;
  const missing: string[] = [];
  const changed: Array<{ name: string; from: number | null; to: number | null }> = [];
  const queue = [...products];
  const work = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      try {
        const s = p.url ? await readItem(p.url) : await findByBarcode(p.barcode);
        if (!s || s.price == null) { missing.push(p.name); continue; }
        await db.from('podium_products').update(siteRow(s)).eq('id', p.id);
        updated++;
        if (s.price !== p.price) changed.push({ name: p.name, from: p.price, to: s.price });
      } catch { missing.push(p.name); }
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  return { updated, missing, changed };
}

/** "הוספת קישור": the admin found the product on the site — read it and save it on the product. */
export async function linkProduct(db: Db, id: string, url: string): Promise<PodiumProduct> {
  const s = await readItem(url);
  if (s.price == null) throw new Error('no price on that page');
  const { data, error } = await db.from('podium_products').update(siteRow(s)).eq('id', id).select('*').single();
  if (error) throw error;
  return toProduct(data);
}

/** How many of each product arrived for a round; a product with no row arrived in full. */
export async function loadReceived(db: Db, roundId: string, ordered: Map<string, number>): Promise<{ received: Record<string, number>; recorded: boolean }> {
  const { data, error } = await db.from('podium_received').select('product_id, quantity').eq('round_id', roundId);
  if (error) return { received: Object.fromEntries(ordered), recorded: false };
  const rows = (data ?? []) as Array<{ product_id: string; quantity: number }>;
  const received: Record<string, number> = Object.fromEntries(ordered);
  for (const r of rows) received[r.product_id] = r.quantity;
  return { received, recorded: rows.length > 0 };
}
