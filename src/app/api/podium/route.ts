import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { isCoreRunner } from '@/lib/core-runner';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { budgetOf, cleanItems, orderTotal, orderable, overBy, roundState, type PodiumRound } from '@/lib/podium/model';
import { audienceOf, currentRound, listRounds, loadOrder, loadOrderById, loadOrders, loadProducts, saveOrder, type OrderRow } from '@/lib/podium/server';
import { canOrderForOthers, readGrants } from '@/lib/access/grants';
import { tellRunner } from '@/lib/podium/notify';
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
  // Ordering for other members (Ofer, 10-29): the admins, and whoever the permissions screen gave it to.
  const forOthers = canOrderForOthers(caller, await readGrants(createServerClient()).catch(() => ({})));
  return { caller, staff, forOthers, athleteId: caller.athleteId, viewer: { athleteId: caller.athleteId, isCore: isCoreRunner(caller), isStaff: staff } };
}

/** The round someone ordering for others works on: theirs, else the newest not yet sent (they may not be in its audience). */
async function roundFor(db: ReturnType<typeof createServerClient>, g: { forOthers: boolean; viewer?: Parameters<typeof currentRound>[1] }): Promise<PodiumRound | null> {
  const own = await currentRound(db, g.viewer!);
  if (own || !g.forOthers) return own;
  const all = await listRounds(db);
  const r = all.find((x) => !x.sentAt) ?? all[0] ?? null;
  return r && { ...r, notMine: true } as PodiumRound;
}

/**
 * Whose order this request is about: `?for=<athleteId>` a member, `?for=g:<orderId>` a group order,
 * nothing = the caller's own. Someone else's only for who may order for others, and only a
 * member the round is open to (or one of the round's group orders).
 */
async function targetOf(db: ReturnType<typeof createServerClient>, round: PodiumRound, forParam: string | null, g: { forOthers: boolean; athleteId?: string }):
  Promise<{ kind: 'me' | 'person' | 'group'; athleteId: string | null; order: OrderRow | null; name: string | null } | { error: Response }> {
  // Not in the round's audience: there is no "mine" to fill, only others'.
  if ((!forParam || forParam === g.athleteId) && (round as { notMine?: boolean }).notMine) return { error: NextResponse.json({ error: 'not in this round', message: 'הסבב לא פתוח לך — בוחרים עבור מי להזמין' }, { status: 404 }) };
  if (!forParam || forParam === g.athleteId) return { kind: 'me', athleteId: g.athleteId!, order: await loadOrder(db, round.id, g.athleteId!), name: null };
  if (!g.forOthers) return { error: NextResponse.json({ error: 'not allowed' }, { status: 403 }) };
  if (forParam.startsWith('g:')) {
    const o = await loadOrderById(db, forParam.slice(2));
    if (!o || o.roundId !== round.id || o.athleteId) return { error: NextResponse.json({ error: 'no such group order' }, { status: 404 }) };
    return { kind: 'group', athleteId: null, order: o, name: o.label ?? null };
  }
  const who = (await audienceOf(db, round)).find((m) => m.id === forParam);
  if (!who) return { error: NextResponse.json({ error: 'not in this round' }, { status: 404 }) };
  return { kind: 'person', athleteId: who.id, order: await loadOrder(db, round.id, who.id), name: who.name };
}

/** The picker's list: everyone the round is open to, who sent and how much, and the group orders. */
async function peopleOf(db: ReturnType<typeof createServerClient>, round: PodiumRound, products: Awaited<ReturnType<typeof loadProducts>>) {
  const [aud, orders] = await Promise.all([audienceOf(db, round), loadOrders(db, round.id)]);
  const byAthlete = new Map(orders.filter((o) => o.athleteId).map((o) => [o.athleteId as string, o]));
  return {
    people: aud.map((m) => {
      const o = byAthlete.get(m.id);
      return { id: m.id, name: m.name, submitted: !!o?.submittedAt, total: o ? orderTotal(o.items, products) : 0, budget: budgetOf(round, o ?? null, m.id) };
    }).sort((a, b) => a.name.localeCompare(b.name)),
    groups: orders.filter((o) => !o.athleteId).map((o) => ({ id: o.id, label: o.label ?? '', submitted: !!o.submittedAt, total: orderTotal(o.items, products), budget: budgetOf(round, o) })),
    expected: round.expectedCount ?? null,
  };
}

export async function GET(request: Request) {
  const g = await gate(request);
  if (g.denied) return g.denied;
  const db = createServerClient();
  try {
    const round = await roundFor(db, g as { forOthers: boolean; viewer?: Parameters<typeof currentRound>[1] });
    if (!round) return NextResponse.json({ round: null, staff: g.staff });
    const forParam = new URL(request.url).searchParams.get('for');
    const allProducts = await loadProducts(db);
    // Ordering for others in a round that isn't theirs: no own order, straight to "for whom".
    if ((round as { notMine?: boolean }).notMine && !forParam) {
      return NextResponse.json({
        staff: g.staff, round: { ...round, state: roundState(round) }, products: allProducts.filter(orderable), order: null, delivered: null,
        budget: round.budget, forOthers: true, target: { kind: 'none', id: null, name: null }, ...(await peopleOf(db, round, allProducts)),
      });
    }
    const target = await targetOf(db, round, forParam, g as { forOthers: boolean; athleteId?: string });
    if ('error' in target) return target.error;
    const order = target.order;
    // Handed over: what they got and what didn't arrive (lib/podium/receive) — told only after "נמסר".
    const delivered = order?.deliveredAt ? (await receiveView(db, round, { products: allProducts })).shares[order.id] ?? null : null;
    const products = allProducts.filter((p) => orderable(p) || !!order?.items[p.id]);
    return NextResponse.json({
      staff: g.staff,
      round: { ...round, state: roundState(round) },
      products,
      delivered: delivered && { at: order!.deliveredAt, got: delivered.got, missing: delivered.missing, gotValue: delivered.gotValue, missingValue: delivered.missingValue, owes: delivered.owes },
      order: order && { id: order.id, items: order.items, submittedAt: order.submittedAt, approval: order.approval, updatedAt: order.updatedAt, editedByClub: !!order.updatedBy && order.updatedBy !== (target.athleteId ?? g.athleteId) },
      // This order's budget: the person's own in the round, a group order's own, else the round's (migration 175).
      budget: budgetOf(round, order, target.athleteId),
      forOthers: g.forOthers,
      target: { kind: target.kind, id: target.kind === 'group' ? order?.id ?? null : target.athleteId, name: target.name },
      ...(g.forOthers ? await peopleOf(db, round, allProducts) : {}),
    });
  } catch (err) {
    console.error('[podium] read failed', err);
    return NextResponse.json({ round: null, staff: g.staff, error: 'not set up' });
  }
}

export async function PUT(request: Request) {
  const g = await gate(request);
  if (g.denied) return g.denied;
  const body = await request.json().catch(() => ({})) as { items?: unknown; submit?: boolean; acceptOverage?: boolean; for?: string };
  const db = createServerClient();
  const round = await roundFor(db, g as { forOthers: boolean; viewer?: Parameters<typeof currentRound>[1] });
  if (!round || roundState(round) !== 'open') return NextResponse.json({ error: 'closed', message: 'ההזמנה סגורה לשינויים' }, { status: 409 });
  const target = await targetOf(db, round, typeof body.for === 'string' ? body.for : null, g as { forOthers: boolean; athleteId?: string });
  if ('error' in target) return target.error;
  const products = await loadProducts(db);
  const total = orderTotal(cleanItems(body.items, products), products);
  // Over the budget is the runner's to know, not the club's to approve (Ofer 10-28): no block, no
  // "approve?" push — the cart warns them, and the admin's summary shows who's over and by how much.
  const saved = await saveOrder(db, {
    round, athleteId: target.athleteId, orderId: target.kind === 'group' ? target.order?.id : undefined,
    items: body.items, products, by: g.athleteId!, submit: !!body.submit,
  });
  // Ordered for someone: told once it is sent, who did it and what it comes to (not on every tap).
  if (target.kind === 'person' && body.submit && target.athleteId) {
    const { data: me } = await db.from('athletes').select('name').eq('id', g.athleteId!).maybeSingle();
    await tellRunner({ athleteId: target.athleteId, kind: 'orderedFor', round, total, actorId: g.athleteId!, actorName: (me as { name?: string } | null)?.name?.split(' ')[0] });
  }
  return NextResponse.json({ order: { id: saved.id, items: saved.items, submittedAt: saved.submittedAt, approval: saved.approval, updatedAt: saved.updatedAt, editedByClub: target.kind !== 'me' } });
}
