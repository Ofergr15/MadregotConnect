import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { loadOrders, loadRound } from '@/lib/podium/server';
import { receiveView } from '@/lib/podium/receive-server';

export const dynamic = 'force-dynamic';

/**
 * Receiving a round's goods (lib/podium/receive). GET ?round= — what was ordered, what arrived,
 * each runner's share and what's missing (items and ₪). POST { round, received: { productId: qty } }
 * records what arrived; { round, done: true|false } closes or reopens receiving.
 */
export async function GET(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const db = createServerClient();
  const round = await loadRound(db, new URL(request.url).searchParams.get('round') ?? '');
  if (!round) return NextResponse.json({ error: 'no round' }, { status: 404 });
  try {
    return NextResponse.json(await receiveView(db, round));
  } catch (err) {
    console.error('[podium/receive] read failed', err);
    return NextResponse.json({ error: 'not set up', message: 'צריך להריץ את מיגרציה 173' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const b = await request.json().catch(() => ({})) as { round?: string; received?: Record<string, unknown>; done?: boolean };
  const db = createServerClient();
  const round = await loadRound(db, b.round ?? '');
  if (!round) return NextResponse.json({ error: 'no round' }, { status: 404 });
  if (!round.sentAt) return NextResponse.json({ error: 'not sent', message: 'קודם מסמנים שההזמנה נשלחה לפודיום' }, { status: 409 });
  if (b.received && typeof b.received === 'object') {
    const orders = await loadOrders(db, round.id);
    const known = new Set(orders.flatMap((o) => Object.keys(o.items)));
    const rows = Object.entries(b.received)
      .filter(([id]) => known.has(id))
      .map(([product_id, v]) => ({ round_id: round.id, product_id, quantity: Math.max(0, Math.min(9999, Math.floor(Number(v) || 0))) }));
    if (rows.length) {
      const { error } = await db.from('podium_received').upsert(rows, { onConflict: 'round_id,product_id' });
      if (error) return NextResponse.json({ error: 'failed', message: 'צריך להריץ את מיגרציה 173' }, { status: 500 });
    }
  }
  if (typeof b.done === 'boolean') {
    const { error } = await db.from('podium_rounds').update({ received_at: b.done ? new Date().toISOString() : null }).eq('id', round.id);
    if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
  return NextResponse.json(await receiveView(db, (await loadRound(db, round.id))!));
}
