import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

// GET /api/admin/store/orders — staff-only, every order across the club,
// newest first, joined to the athlete's name/phone for staff to arrange
// payment/pickup (no processor connected yet — see migration 064).
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  const supabase = createServerClient();
  const { data: orders, error } = await supabase
    .from('store_orders')
    .select('id, athlete_id, status, total, contact_phone, notes, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    if ((error as { code?: string }).code === 'PGRST205') return NextResponse.json({ orders: [] });
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }

  const rows = (orders || []) as Array<Record<string, unknown>>;
  const athleteIds = Array.from(new Set(rows.map((o) => o.athlete_id as string)));
  const orderIds = rows.map((o) => o.id as string);

  const [athletesRes, itemsRes] = await Promise.all([
    athleteIds.length
      ? supabase.from('athletes').select('id, name, avatar_url').in('id', athleteIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabase.from('store_order_items').select('order_id, product_name_he, size, quantity, unit_price').in('order_id', orderIds)
      : Promise.resolve({ data: [] }),
  ]);

  const athleteById = new Map(
    ((athletesRes.data || []) as Array<{ id: string; name: string; avatar_url: string | null }>).map((a) => [a.id, a]),
  );
  const itemsByOrder = new Map<string, unknown[]>();
  for (const item of (itemsRes.data || []) as Array<Record<string, unknown>>) {
    const orderId = item.order_id as string;
    const bucket = itemsByOrder.get(orderId) || [];
    bucket.push({ nameHe: item.product_name_he, size: item.size, quantity: item.quantity, unitPrice: item.unit_price });
    itemsByOrder.set(orderId, bucket);
  }

  const result = rows.map((o) => {
    const athlete = athleteById.get(o.athlete_id as string);
    return {
      id: o.id,
      athleteName: athlete?.name || null,
      athleteAvatarUrl: athlete?.avatar_url || null,
      status: o.status,
      total: o.total,
      contactPhone: o.contact_phone,
      notes: o.notes,
      createdAt: o.created_at,
      items: itemsByOrder.get(o.id as string) || [],
    };
  });

  return NextResponse.json({ orders: result });
}
