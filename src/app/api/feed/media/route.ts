import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, authError } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

// The client downscales to a long edge of ~1600px before uploading, so anything much
// larger than this is either a client that skipped the resize or an abuse attempt.
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/**
 * POST /api/feed/media  (multipart: file, w?, h?)
 *
 * Uploads one post image to the public `feed-media` bucket and returns the descriptor
 * the composer then passes to /api/feed/posts.
 *
 * Paths are namespaced by the athlete id taken from the VERIFIED JWT — never from a
 * client-supplied id — so one member cannot write into another's namespace.
 */
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });

    if (!file.type.startsWith('image/') || !ALLOWED.includes(file.type)) {
      return NextResponse.json(
        { error: 'Only JPEG, PNG, WebP or HEIC images are supported' },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image is too large (max 8MB)' }, { status: 400 });
    }

    const supabase = createServerClient();
    const ext =
      file.type === 'image/png' ? 'png'
      : file.type === 'image/webp' ? 'webp'
      : file.type === 'image/heic' || file.type === 'image/heif' ? 'heic'
      : 'jpg';

    // crypto.randomUUID is available in the Node runtime Next uses for route handlers.
    const path = `${auth.user.athleteId}/${crypto.randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from('feed-media')
      .upload(path, buffer, { contentType: file.type, upsert: false });
    if (uploadError) {
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from('feed-media').getPublicUrl(path);

    // Intrinsic dimensions come from the client (it already decoded the image to
    // resize it). They're only used to reserve aspect-ratio space in the feed and
    // avoid layout shift, so a missing or wrong value is cosmetic, never a security
    // concern — hence no server-side image parsing.
    const w = Number(form.get('w')) || null;
    const h = Number(form.get('h')) || null;

    return NextResponse.json({
      media: { path, url: urlData.publicUrl, w: Number.isFinite(w) ? w : null, h: Number.isFinite(h) ? h : null },
    });
  } catch (err: unknown) {
    console.error('Feed media upload error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
