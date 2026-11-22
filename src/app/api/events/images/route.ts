import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/** Output geometry per slot: a cover is a wide hero, a logo a small square chip. */
export const IMAGE_SLOTS = {
  cover: { width: 1600, height: 900, fit: 'cover' as const, quality: 78 },
  logo: { width: 400, height: 400, fit: 'inside' as const, quality: 85 },
};

/**
 * POST /api/events/images (multipart: file, slot=cover|logo) — staff only.
 * Re-encodes to WebP at a fixed size (EXIF stripped by sharp), uploads to the public
 * `event-images` bucket (migration 184), returns { url } for PATCH /api/events/[id].
 */
export async function POST(request: Request) {
  const denied = await requireStaff(request);
  if (denied) return denied;
  try {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    const slot = form.get('slot') === 'logo' ? 'logo' : 'cover';
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image is too large (max 12MB)' }, { status: 400 });

    const spec = IMAGE_SLOTS[slot];
    const out = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: spec.width, height: spec.height, fit: spec.fit, withoutEnlargement: true })
      .webp({ quality: spec.quality })
      .toBuffer();

    const supabase = createServerClient();
    const path = `${slot}/${crypto.randomUUID()}.webp`;
    const { error } = await supabase.storage.from('event-images').upload(path, out, { contentType: 'image/webp', upsert: false });
    if (error) return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
    const { data } = supabase.storage.from('event-images').getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl, path, bytes: out.length });
  } catch (err) {
    console.error('Event image upload error:', err);
    return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
  }
}
