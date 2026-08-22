import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET /api/store/products — the public catalog (active products only).
// Roadmap #9, Store / E-Commerce. No auth required — same "public read"
// convention as GET /api/badges: a product catalog is never athlete-specific.
export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('store_products')
      .select('id, name_he, name_en, description_he, description_en, price, image_url, sizes, stock')
      .eq('active', true)
      .order('created_at', { ascending: false });
    if (error) {
      if ((error as { code?: string }).code === 'PGRST205') return NextResponse.json({ products: [] });
      throw error;
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
    }));

    return NextResponse.json({ products });
  } catch (error) {
    console.error('Failed to fetch store products:', error);
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}
