import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { isCoreRunner } from '@/lib/core-runner';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { cleanItems, orderTotal, orderable, overBy, roundState } from '@/lib/podium/model';
import { currentRound, loadOrder, loadProducts, saveOrder } from '@/lib/podium/server';
import { receiveView } from '@/lib/podium/receive-server';

export const dynamic = 'force-dynamic';

/**
 * הזמנת פודיום, the runner's side (lib/podium). GET: the current round, the catalog a runner
 * may order from, and their own order. PUT: save the cart ({ items }) or send it
 * ({ items, submit: true }). Over the budget is allowed (the runner is warned). Only rounds whose audience includes the caller
 * ('me' / admins / chosen people / the core / everyone).
 * Nothing changes once the round locks.
 */
async function gate(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied };
  const staff = caller.isStaff || caller.isSuperUser;
  if (!caller.athleteId) return { denied: NextResponse.json({ error: 'no athlete' }, { status: 403 }) };
  // Who may order is the round's own audience (lib/podium/model audienceAllows), so no gate here
  // beyond being signed in: a round not open to you simply isn't there.
  return { caller, staff, athleteId: caller.athleteId, viewer: { athleteId: caller.athleteId, isCore: isCoreRunner(caller), isStaff: staff } };
}

export async function GET(request: Request) {
  const g = await gate(request);
  if (g.denied) return g.denied;
  const db = createServerClient();
  try {
    const round = await currentRound(db, g.viewer!);
    if (!round) return NextResponse.json({ round: null, staff: g.staff });
    const [allProducts, order] = await Promise.all([loadProducts(db), loadOrder(db, round.id, g.athleteId)]);
    // Handed over: what they got and what didn't arrive (lib/podium/receive) — told only after "נמסר".
    const delivered = order?.deliveredAt ? (await receiveView(db, round, { products: allProducts })).shares[order.id] ?? null : null;
    const products = allProducts.filter((p) => orderable(p) || !!order?.items[p.id]);
    return NextResponse.json({
      staff: g.staff,
      round: { ...round, state: roundState(round) },
      products,
      delivered: delivered && { at: order!.deliveredAt, got: delivered.got, missing: delivered.missing, gotValue: delivered.gotValue, missingValue: delivered.missingValue, owes: delivered.owes },
      order: order && { id: order.id, items: order.items, submittedAt: order.submittedAt, approval: order.approval, updatedAt: order.updatedAt, editedByClub: !!order.updatedBy && order.updatedBy !== g.athleteId },
    });
  } catch (err) {
    console.error('[podium] read failed', err);
    return NextResponse.json({ round: null, staff: g.staff, error: 'not set up' });
  }
}

export async function PUT(request: Request) {
  const g = await gate(request);
  if (g.denied) return g.denied;
  const body = await request.json().catch(() => ({})) as { items?: unknown; submit?: boolean; acceptOverage?: boolean };
  const db = createServerClient();
  const round = await currentRound(db, g.viewer!);
  if (!round || roundState(round) !== 'open') return NextResponse.json({ error: 'closed', message: 'ההזמנה סגורה לשינויים' }, { status: 409 });
  const products = await loadProducts(db);
  const total = orderTotal(cleanItems(body.items, products), products);
  // Over the budget is the runner's to know, not the club's to approve (Ofer 10-28): no block, no
  // "approve?" push — the cart warns them, and the admin's summary shows who's over and by how much.
  const saved = await saveOrder(db, { round, athleteId: g.athleteId, items: body.items, products, by: g.athleteId, submit: !!body.submit });
  return NextResponse.json({ order: { id: saved.id, items: saved.items, submittedAt: saved.submittedAt, approval: saved.approval, updatedAt: saved.updatedAt, editedByClub: false } });
}
