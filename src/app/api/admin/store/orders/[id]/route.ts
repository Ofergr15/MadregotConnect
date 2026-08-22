import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

const STATUSES = ['pending_payment', 'paid', 'fulfilled', 'cancelled'] as const;

// PATCH /api/admin/store/orders/[id] { status }
// Staff manually advances an order once payment is arranged out-of-band (no
// processor connected yet) and once merchandise is handed over.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  try {
    const { id } = await params;
    const { status } = await request.json();
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase.from('store_orders').update({ status }).eq('id', id).select().single();
    if (error) throw error;

    return NextResponse.json({ order: data });
  } catch (error) {
    console.error('Failed to update order:', error);
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
  }
}
