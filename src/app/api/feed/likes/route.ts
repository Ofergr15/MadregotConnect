import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { LIKER_SELECT, projectLike } from '@/lib/feed/project';

export const dynamic = 'force-dynamic';

// A club feed item realistically tops out in the low hundreds of likes. Capping
// keeps the sheet's payload bounded; the card already knows the true total from
// like_count, so the sheet can still show "ועוד N" for anyone past the cap.
const MAX_LIKERS = 200;

/**
 * GET /api/feed/likes?itemId=… — everyone who liked an item, newest first.
 *
 * Split out from /api/feed rather than inlined: the feed payload carries only the
 * first LIKE_PREVIEW_COUNT likers, so this is what the "ועוד N" sheet calls when a
 * member actually wants the full list.
 */
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);

  try {
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('itemId');
    if (!itemId) {
      return NextResponse.json({ error: 'itemId required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Uses the index behind UNIQUE(feed_item_id, athlete_id).
    const { data, error } = await supabase
      .from('feed_likes')
      .select(LIKER_SELECT)
      .eq('feed_item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(MAX_LIKERS);
    if (error) throw error;

    const likers = (data || [])
      .map(projectLike)
      .filter(projected => projected !== null)
      .map(projected => projected.liker);

    return NextResponse.json({ likers });
  } catch (err: unknown) {
    console.error('Feed likes fetch error:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to load likes' },
      { status: 500 },
    );
  }
}
