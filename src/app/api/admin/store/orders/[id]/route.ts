import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { ORDER_STATUSES, isOrderStatus, statusEvent } from '@/lib/store/order-history';

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
    const { status } = await request.json();
    if (!isOrderStatus(status)) {
      return NextResponse.json({ error: `status must be one of ${ORDER_STATUSES.join(', ')}` }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: before } = await supabase.from('store_orders').select('status').eq('id', id).maybeSingle();
    const { data, error } = await supabase.from('store_orders').update({ status }).eq('id', id).select().single();
    if (error) throw error;

    const event = statusEvent(id, (before as { status?: string } | null)?.status ?? null, status, {
      athleteId: auth.user.athleteId, name: auth.user.name,
    });
    if (event) {
      const { error: hErr } = await supabase.from('store_order_status_events').insert({ ...event, changed_at: new Date().toISOString() });
      if (hErr && !isMissingTable(hErr)) console.error('store order history write failed:', hErr);
    }

    return NextResponse.json({ order: data });
  } catch (error) {
    console.error('Failed to update order:', error);
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
  }
}
