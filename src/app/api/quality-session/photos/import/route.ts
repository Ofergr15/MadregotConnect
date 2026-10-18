import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { isStoryEditor } from '@/lib/quality-session/access';
import { MAX_SESSION_PHOTOS } from '@/lib/quality-session/photos';
import { pullAlbumPhotos } from '@/lib/quality-session/album-fetch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/quality-session/photos/import { link } -> { media, found } | { error }
//   Reads the album the link points at (lib/quality-session/album-fetch.ts), takes
//   the first photos, shrinks each to 1600 px JPEG and files it in feed-media under
//   the caller's id — so publishing goes through the same ownership check as a
//   photo picked from the phone. Errors: 'unsupported' (not a Drive folder /
//   Photos album: keep it as a link), 'not-shared' (Google wants a login), 'no-photos'.
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const supabase = createServerClient();
  if (!auth.user.athleteId || (!auth.user.isSuperUser && !(await isStoryEditor(supabase, auth.user.athleteId)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const max = Math.min(Math.max(Number(body?.max) || MAX_SESSION_PHOTOS, 1), MAX_SESSION_PHOTOS);
  if (typeof body?.link !== 'string') return NextResponse.json({ error: 'unsupported' }, { status: 400 });
  try {
    const out = await pullAlbumPhotos(supabase, body.link, { prefix: auth.user.athleteId, max });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.error === 'unsupported' ? 400 : 422 });
    return NextResponse.json({ media: out.media, found: out.found });
  } catch (err) {
    console.error('[quality-session/photos/import] failed:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
