import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canApprove } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// Same shape as /api/admin/perks/image, but gated with canApprove(actorEmail)
// — the rest of the Notification Center (/api/notifications) uses that same
// convention rather than requireSession's real-JWT requirement, which isn't
// reliably present for every admin session in this app (see AttendanceRSVP /
// ActivitySyncEditor's own NOT_SIGNED_IN handling for the same gap).
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

// POST /api/admin/notifications/image (multipart: file, actorEmail)
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const actorEmail = form.get('actorEmail') as string | null;
    if (!canApprove(actorEmail)) {
      return NextResponse.json({ error: 'Not authorized to upload notification images.' }, { status: 403 });
    }

    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });

    if (!file.type.startsWith('image/') || !ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG or WebP images are supported' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image is too large (max 4MB)' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'File is empty' }, { status: 400 });
    }

    const supabase = createServerClient();
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${crypto.randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from('notification-images')
      .upload(path, buffer, { contentType: file.type, upsert: false });
    if (uploadError) {
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from('notification-images').getPublicUrl(path);
    return NextResponse.json({ path, url: urlData.publicUrl });
  } catch (err: unknown) {
    console.error('Notification image upload error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
