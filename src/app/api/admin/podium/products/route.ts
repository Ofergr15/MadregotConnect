import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { isPodiumItemUrl } from '@/lib/podium/site';
import { checkPrices, linkProduct, loadProducts } from '@/lib/podium/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The catalog, as the club: { action: 'check' } re-reads every product's price, deal and photo
 * from podiumsport.co.il; { action: 'link', id, url } attaches a product page the admin found for
 * a product the barcode search missed; { action: 'hide', id, hidden } takes one off the runners' list.
 */
export async function POST(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const b = await request.json().catch(() => ({})) as { action?: string; id?: string; url?: string; hidden?: boolean };
  const db = createServerClient();
  if (b.action === 'check') {
    const r = await checkPrices(db, await loadProducts(db));
    return NextResponse.json(r);
  }
  if (b.action === 'link' && b.id && b.url) {
    if (!isPodiumItemUrl(b.url.trim())) return NextResponse.json({ error: 'bad link', message: 'צריך קישור לעמוד מוצר ב-podiumsport.co.il' }, { status: 400 });
    try {
      return NextResponse.json({ product: await linkProduct(db, b.id, b.url.trim()) });
    } catch {
      return NextResponse.json({ error: 'unreadable', message: 'לא הצלחנו לקרוא מחיר מהעמוד הזה' }, { status: 422 });
    }
  }
  if (b.action === 'hide' && b.id) {
    const { error } = await db.from('podium_products').update({ hidden: !!b.hidden }).eq('id', b.id);
    if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
