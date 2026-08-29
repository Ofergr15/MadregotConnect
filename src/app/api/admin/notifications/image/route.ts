import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireApprover } from '@/lib/auth/require-approver';

export const dynamic = 'force-dynamic';

// Same shape as /api/admin/perks/image. It used to gate on an `actorEmail` form
// field because a real JWT wasn't reliably present for admin sessions — that was
// true until /admin/login started minting one (v2.34.23), so it now uses the
// same verified-session gate as the rest of the Notification Center.
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

// POST /api/admin/notifications/image (multipart: file)
export async function POST(request: Request) {
  try {
    const { denied } = await requireApprover(request);
    if (denied) return denied;

    const form = await request.formData();
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
