import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { ORDER_STATUSES, checkTransition, isOrderStatus, normalNext, statusEvent } from '@/lib/store/order-history';

export const dynamic = 'force-dynamic';

// PATCH /api/admin/store/orders/[id] { status }
// Staff manually advances an order once payment is arranged out-of-band (no
// processor connected yet) and once merchandise is handed over.
//
// Every real change also writes a store_order_status_events row (migration 231):
// who (from the session, never the body), from what, to what. The history write
// is best-effort — before 231 is applied, or if it fails, the status change still
// stands and the failure is logged.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const status = body?.status;
    if (!isOrderStatus(status)) {
      return NextResponse.json({ error: `status must be one of ${ORDER_STATUSES.join(', ')}` }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: before, error: readErr } = await supabase.from('store_orders').select('status').eq('id', id).maybeSingle();
    if (readErr) throw readErr;
    if (!before) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    const from = (before as { status?: string }).status ?? null;

    // Task 84: no skipping or back-stepping without a reason.
    const check = checkTransition(from, status, body?.reason);
    if (!check.ok) {
      return NextResponse.json(
        { error: check.error, from, to: status, allowed: normalNext(from) },
        { status: check.error === 'reason_too_long' ? 400 : 409 },
      );
    }

    // Compare-and-set on the status we checked, so two staff phones can't both apply a
    // transition that was only valid from the old status.
    let q = supabase.from('store_orders').update({ status }).eq('id', id);
    q = from == null ? q.is('status', null) : q.eq('status', from);
    const { data, error } = await q.select().maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'status_changed', message: 'The order changed meanwhile — reload' }, { status: 409 });

    const event = statusEvent(id, from, status, { athleteId: auth.user.athleteId, name: auth.user.name });
    if (event) {
      const row = { ...event, reason: check.reason, changed_at: new Date().toISOString() };
      let { error: hErr } = await supabase.from('store_order_status_events').insert(row);
      if (hErr && isMissingColumn(hErr, 'reason')) {
        // 250 not applied yet: keep the audit row, put the reason in the function log.
        if (check.reason) console.warn('store order reason (migration 250 pending):', { id, from, to: status, reason: check.reason });
        const { reason: _r, ...noReason } = row;
        ({ error: hErr } = await supabase.from('store_order_status_events').insert(noReason));
      }
      if (hErr && !isMissingTable(hErr)) console.error('store order history write failed:', hErr);
    }

    return NextResponse.json({ order: data });
  } catch (error) {
    console.error('Failed to update order:', error);
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
  }
}
