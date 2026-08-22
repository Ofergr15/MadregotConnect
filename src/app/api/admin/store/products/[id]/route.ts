import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

// PATCH /api/admin/store/products/[id] — staff-only partial update (e.g.
// toggling `active`, editing price). Every field optional; only provided
// keys are written.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  try {
    const { id } = await params;
    const body = await request.json();
    const { nameHe, nameEn, descriptionHe, descriptionEn, price, imageUrl, sizes, colors, stock, active } = body as {
      nameHe?: string; nameEn?: string; descriptionHe?: string; descriptionEn?: string;
      price?: number; imageUrl?: string; sizes?: string[]; colors?: string[]; stock?: number; active?: boolean;
    };

    const updates: Record<string, unknown> = {};
    if (nameHe !== undefined) updates.name_he = nameHe.trim();
    if (nameEn !== undefined) updates.name_en = nameEn.trim();
    if (descriptionHe !== undefined) updates.description_he = descriptionHe?.trim() || null;
    if (descriptionEn !== undefined) updates.description_en = descriptionEn?.trim() || null;
    if (price !== undefined) updates.price = Number(price);
    if (imageUrl !== undefined) updates.image_url = imageUrl || null;
    if (sizes !== undefined) updates.sizes = Array.isArray(sizes) && sizes.length > 0 ? sizes : null;
    if (colors !== undefined) updates.colors = Array.isArray(colors) && colors.length > 0 ? colors : null;
    if (stock !== undefined) updates.stock = stock == null ? null : Number(stock);
    if (active !== undefined) updates.active = !!active;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase.from('store_products').update(updates).eq('id', id).select().single();
    if (error) throw error;

    return NextResponse.json({ product: data });
  } catch (error) {
    console.error('Failed to update product:', error);
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
  }
}
