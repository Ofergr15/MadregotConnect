import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { fileRouteUrl } from '@/lib/storage/buckets';
import { requireSession, authError } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

// Mirrors /api/admin/badges/icon exactly, targeting the `store-products`
// bucket (migration 064) instead.
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

// POST /api/admin/store/products/image (multipart: file)
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }

  try {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });

    if (!file.type.startsWith('image/') || !ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG or WebP images are supported' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image is too large (max 4MB)' }, { status: 400 });
    }

    const supabase = createServerClient();
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${crypto.randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from('store-products')
      .upload(path, buffer, { contentType: file.type, upsert: false });
    if (uploadError) {
      console.error('[api/admin/store/products/image]', uploadError);
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }

    return NextResponse.json({ path, url: fileRouteUrl('store-products', path) });
  } catch (err: unknown) {
    console.error('Store product image upload error:', err);
    console.error('[api/admin/store/products/image]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
