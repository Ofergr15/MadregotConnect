import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireBirthdayAdmin } from '@/lib/birthday-year/access';
import { readStorySettings } from '@/lib/stories/gate';

export const dynamic = 'force-dynamic';

// The /api/feed/media recipe (type and size gate, service-role upload, public URL back),
// into the same public `feed-media` bucket under birthday/, admin-only.
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

export async function POST(request: Request) {
  const { denied } = await requireBirthdayAdmin(request);
  if (denied) return denied;
  if (((await readStorySettings('birthday'))?.state ?? 'off') === 'off') return NextResponse.json({ error: 'birthday stories are off' }, { status: 409 });
  try {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'JPEG, PNG or WebP only' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image is too large (max 8MB)' }, { status: 400 });
    const supabase = createServerClient();
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `birthday/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('feed-media')
      .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (error) return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
    const { data } = supabase.storage.from('feed-media').getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl });
  } catch (err) {
    console.error('birthday photo upload failed:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
