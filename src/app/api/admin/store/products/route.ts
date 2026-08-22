import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

// GET /api/admin/store/products — staff-only, full catalog incl. inactive
// (the public GET /api/store/products only shows active ones).
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('store_products')
    .select('id, name_he, name_en, description_he, description_en, price, image_url, sizes, stock, active, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    if ((error as { code?: string }).code === 'PGRST205') return NextResponse.json({ products: [] });
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }

  const products = (data || []).map((p: Record<string, unknown>) => ({
    id: p.id,
    nameHe: p.name_he,
    nameEn: p.name_en,
    descriptionHe: p.description_he,
    descriptionEn: p.description_en,
    price: p.price,
    imageUrl: p.image_url,
    sizes: p.sizes || null,
    stock: p.stock,
    active: p.active,
  }));

  return NextResponse.json({ products });
}

// POST /api/admin/store/products — staff-only create.
// Body: { nameHe, nameEn, descriptionHe?, descriptionEn?, price, imageUrl?, sizes?: string[], stock?: number }
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  try {
    const body = await request.json();
    const { nameHe, nameEn, descriptionHe, descriptionEn, price, imageUrl, sizes, stock } = body as {
      nameHe?: string; nameEn?: string; descriptionHe?: string; descriptionEn?: string;
      price?: number; imageUrl?: string; sizes?: string[]; stock?: number;
    };

    if (!nameHe?.trim() || !nameEn?.trim()) {
      return NextResponse.json({ error: 'nameHe and nameEn are required' }, { status: 400 });
    }
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return NextResponse.json({ error: 'price must be a non-negative number' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('store_products')
      .insert({
        name_he: nameHe.trim(),
        name_en: nameEn.trim(),
        description_he: descriptionHe?.trim() || null,
        description_en: descriptionEn?.trim() || null,
        price: priceNum,
        image_url: imageUrl || null,
        sizes: Array.isArray(sizes) && sizes.length > 0 ? sizes : null,
        stock: stock != null && Number.isFinite(Number(stock)) ? Number(stock) : null,
        created_by: auth.user.athleteId,
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ product: data });
  } catch (error) {
    console.error('Failed to create product:', error);
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
  }
}
