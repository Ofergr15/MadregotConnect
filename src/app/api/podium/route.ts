import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { isCoreRunner } from '@/lib/core-runner';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { cleanItems, orderTotal, orderable, overBy, roundState } from '@/lib/podium/model';
import { currentRound, loadOrder, loadProducts, saveOrder } from '@/lib/podium/server';
import { askApproval } from '@/lib/podium/notify';

export const dynamic = 'force-dynamic';

/**
 * הזמנת פודיום, the runner's side (lib/podium). GET: the current round, the catalog a runner
 * may order from, and their own order. PUT: save the cart ({ items }) or send it
 * ({ items, submit: true, acceptOverage }). Only rounds whose audience includes the caller
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
    const [products, order] = await Promise.all([loadProducts(db), loadOrder(db, round.id, g.athleteId)]);
    return NextResponse.json({
      staff: g.staff,
      round: { ...round, state: roundState(round) },
      products: products.filter(orderable),
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
  if (body.submit && overBy(total, round.budget) > 0 && !body.acceptOverage) {
    return NextResponse.json({ error: 'over', over: overBy(total, round.budget) }, { status: 409 });
  }
  const prev = await loadOrder(db, round.id, g.athleteId);
  // A sent order that a later tap pushes over the budget (beyond what was approved) goes back to
  // a draft: going over needs the runner's "the difference is on me" again, on the send.
  const newlyOver = !body.submit && !!prev?.submittedAt && overBy(total, round.budget) > 0
    && !(prev.approval === 'approved' && total <= (prev.approvedTotal ?? 0))
    && !(prev.approval === 'pending' && total <= orderTotal(prev.items, products));
  const saved = await saveOrder(db, { round, athleteId: g.athleteId, items: body.items, products, by: g.athleteId, submit: !!body.submit, unsubmit: newlyOver });
  // Ask the staff the moment a sent order needs a yes — once per "needs it" (not on every tap).
  if (saved.submittedAt && saved.approval === 'pending' && (prev?.approval !== 'pending' || !prev?.submittedAt)) {
    const { data: a } = await db.from('athletes').select('name').eq('id', g.athleteId).maybeSingle();
    await askApproval({ round, athleteId: g.athleteId, name: (a as { name?: string } | null)?.name ?? 'רץ', total: orderTotal(saved.items, products), orderId: saved.id });
  }
  return NextResponse.json({ order: { id: saved.id, items: saved.items, submittedAt: saved.submittedAt, approval: saved.approval, updatedAt: saved.updatedAt, editedByClub: false } });
}
