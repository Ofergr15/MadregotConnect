import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface CartLine {
  productId: string;
  size?: string | null;
  color?: string | null;
  quantity: number;
}

// GET /api/store/orders?athleteId=… — the athlete's own purchase history.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });

    const supabase = createServerClient();
    const { data: orders, error } = await supabase
      .from('store_orders')
      .select('id, status, total, created_at')
      .eq('athlete_id', athleteId)
      .order('created_at', { ascending: false });
    if (error) {
      if ((error as { code?: string }).code === 'PGRST205') return NextResponse.json({ orders: [] });
      throw error;
    }

    const orderIds = (orders || []).map((o: { id: string }) => o.id);
    const { data: items } = orderIds.length
      ? await supabase
          .from('store_order_items')
          .select('order_id, product_name_he, product_name_en, size, color, quantity, unit_price')
          .in('order_id', orderIds)
      : { data: [] };

    const itemsByOrder = new Map<string, unknown[]>();
    for (const item of (items || []) as Array<{ order_id: string } & Record<string, unknown>>) {
      const bucket = itemsByOrder.get(item.order_id) || [];
      bucket.push({
        nameHe: item.product_name_he,
        nameEn: item.product_name_en,
        size: item.size,
        color: item.color,
        quantity: item.quantity,
        unitPrice: item.unit_price,
      });
      itemsByOrder.set(item.order_id, bucket);
    }

    const result = (orders || []).map((o: { id: string; status: string; total: number; created_at: string }) => ({
      id: o.id,
      status: o.status,
      total: o.total,
      createdAt: o.created_at,
      items: itemsByOrder.get(o.id) || [],
    }));

    return NextResponse.json({ orders: result });
  } catch (error) {
    console.error('Failed to fetch orders:', error);
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}

// POST /api/store/orders { athleteId, items: [{productId, size?, quantity}], contactPhone?, notes? }
//
// Checkout — creates the order + line items. No payment is processed here:
// a payment processor isn't connected yet (product decision, roadmap #9), so
// every order lands as 'pending_payment' and staff arranges payment
// out-of-band, then marks it paid via the admin order manager. Price/name are
// always re-read from the current product row server-side, never trusted
// from the client, and snapshotted onto the line item so a later product
// edit can't rewrite a past order's history.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { athleteId, items, contactPhone, notes } = body as {
      athleteId?: string;
      items?: CartLine[];
      contactPhone?: string;
      notes?: string;
    };
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const productIds = Array.from(new Set(items.map((i) => i.productId)));
    const { data: products, error: productsError } = await supabase
      .from('store_products')
      .select('id, name_he, name_en, price, active')
      .in('id', productIds);
    if (productsError) throw productsError;

    const productById = new Map(
      ((products || []) as Array<{ id: string; name_he: string; name_en: string; price: number; active: boolean }>).map(
        (p) => [p.id, p],
      ),
    );

    const lineItems: Array<{
      product_id: string; product_name_he: string; product_name_en: string;
      size: string | null; color: string | null; quantity: number; unit_price: number;
    }> = [];
    let total = 0;
    for (const line of items) {
      const product = productById.get(line.productId);
      if (!product || !product.active) {
        return NextResponse.json({ error: 'One of the items is no longer available' }, { status: 400 });
      }
      const quantity = Math.max(1, Math.floor(Number(line.quantity) || 1));
      lineItems.push({
        product_id: product.id,
        product_name_he: product.name_he,
        product_name_en: product.name_en,
        size: line.size || null,
        color: line.color || null,
        quantity,
        unit_price: product.price,
      });
      total += product.price * quantity;
    }

    const { data: order, error: orderError } = await supabase
      .from('store_orders')
      .insert({
        athlete_id: athleteId,
        status: 'pending_payment',
        total,
        contact_phone: contactPhone?.trim() || null,
        notes: notes?.trim() || null,
      })
      .select('id, created_at')
      .single();
    if (orderError) throw orderError;

    const { error: itemsError } = await supabase
      .from('store_order_items')
      .insert(lineItems.map((li) => ({ ...li, order_id: order.id })));
    if (itemsError) {
      await supabase.from('store_orders').delete().eq('id', order.id);
      throw itemsError;
    }

    return NextResponse.json({ orderId: order.id, total, createdAt: order.created_at });
  } catch (error) {
    console.error('Failed to place order:', error);
    return NextResponse.json({ error: 'Failed to place order' }, { status: 500 });
  }
}
