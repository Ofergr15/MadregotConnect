import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { orderTotal } from '@/lib/podium/model';
import { loadOrderById, loadProducts, loadRound, saveOrder } from '@/lib/podium/server';
import { tellRunner, tellDelivered } from '@/lib/podium/notify';
import { receiveView } from '@/lib/podium/receive-server';

export const dynamic = 'force-dynamic';

/**
 * PATCH an order as the club: { items } replaces the quantities (allowed after the lock too —
 * the admin fixes things before sending to Podium), { approval: 'approved' | 'rejected' }
 * answers an over-budget order (the runner is told either way). After receiving:
 * { allocation: {…} | null } sets this runner's share by hand (null = back to automatic),
 * { delivered: true | false } marks it handed over — and only then is the runner told what they got.
 * DELETE removes it.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  const { id } = await params;
  const b = await request.json().catch(() => ({})) as { items?: unknown; approval?: string; submit?: boolean; allocation?: Record<string, unknown> | null; delivered?: boolean };
  const db = createServerClient();
  const order = await loadOrderById(db, id);
  if (!order) return NextResponse.json({ error: 'no order' }, { status: 404 });
  const [round, products] = await Promise.all([loadRound(db, order.roundId), loadProducts(db)]);
  if (!round) return NextResponse.json({ error: 'no round' }, { status: 404 });
  if ('allocation' in b || typeof b.delivered === 'boolean') {
    if (!round.sentAt) return NextResponse.json({ error: 'not sent', message: 'קודם מסמנים שההזמנה נשלחה לפודיום' }, { status: 409 });
    if ('allocation' in b) {
      const a = b.allocation && typeof b.allocation === 'object'
        ? Object.fromEntries(Object.entries(b.allocation).filter(([id]) => id in order.items).map(([id, v]) => [id, Math.max(0, Math.min(99, Math.floor(Number(v) || 0)))]).filter(([, q]) => (q as number) > 0))
        : null;
      const { error } = await db.from('podium_orders').update({ allocation: a }).eq('id', id);
      if (error) return NextResponse.json({ error: 'failed', message: 'צריך להריץ את מיגרציה 173' }, { status: 500 });
    }
    if (typeof b.delivered === 'boolean') {
      const { error } = await db.from('podium_orders').update({ delivered_at: b.delivered ? new Date().toISOString() : null, delivered_by: b.delivered ? caller.athleteId : null }).eq('id', id);
      if (error) return NextResponse.json({ error: 'failed', message: 'צריך להריץ את מיגרציה 173' }, { status: 500 });
      if (b.delivered && !order.deliveredAt) {
        const share = (await receiveView(db, round, { products })).shares[id];
        if (share) await tellDelivered({ athleteId: order.athleteId, round, share, actorId: caller.athleteId });
      }
    }
    return NextResponse.json({ ok: true });
  }
  if (round.sentAt) return NextResponse.json({ error: 'sent', message: 'ההזמנה כבר נשלחה לפודיום' }, { status: 409 });
  if (b.approval === 'approved' || b.approval === 'rejected') {
    const total = orderTotal(order.items, products);
    const { error } = await db.from('podium_orders').update({
      approval: b.approval, approved_by: caller.athleteId, approved_at: new Date().toISOString(), approved_total: b.approval === 'approved' ? total : null,
    }).eq('id', id);
    if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });
    await tellRunner({ athleteId: order.athleteId, kind: b.approval, round, total, actorId: caller.athleteId });
    return NextResponse.json({ ok: true });
  }
  const saved = await saveOrder(db, { round, athleteId: order.athleteId, items: b.items, products, by: caller.athleteId, admin: true, submit: b.submit || !!order.submittedAt });
  if (saved.athleteId !== caller.athleteId) {
    await tellRunner({ athleteId: saved.athleteId, kind: 'edited', round, total: orderTotal(saved.items, products), actorId: caller.athleteId });
  }
  return NextResponse.json({ order: saved });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const { id } = await params;
  const { error } = await createServerClient().from('podium_orders').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
