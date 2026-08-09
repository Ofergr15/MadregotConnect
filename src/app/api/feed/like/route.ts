import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, authError } from '@/lib/auth-session';
import { notifyFeedInteraction, loadFeedItemMeta } from '@/lib/feed/notify';
import {
  LIKER_SELECT,
  LIKE_PREVIEW_COUNT,
  projectLiker,
  type FeedLiker,
  type RawLikeRow,
} from '@/lib/feed/project';

export const dynamic = 'force-dynamic';

/**
 * POST /api/feed/like  { itemId }
 *
 * Toggles the caller's like. The athlete is taken from the verified JWT, never from
 * the request body — otherwise anyone could like as anyone.
 *
 * like_count is maintained by a DB trigger, so this route only inserts/deletes the
 * join row and then reads the authoritative count back.
 */
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const { itemId } = await request.json();
    if (!itemId || typeof itemId !== 'string') {
      return NextResponse.json({ error: 'itemId required' }, { status: 400 });
    }

    const meta = await loadFeedItemMeta(itemId);
    if (!meta) return NextResponse.json({ error: 'Feed item not found' }, { status: 404 });

    const supabase = createServerClient();
    const athleteId = auth.user.athleteId;

    const { data: existing } = await supabase
      .from('feed_likes')
      .select('id')
      .eq('feed_item_id', itemId)
      .eq('athlete_id', athleteId)
      .maybeSingle();

    let liked: boolean;
    if (existing) {
      const { error } = await supabase.from('feed_likes').delete().eq('id', existing.id);
      if (error) throw error;
      liked = false;
    } else {
      const { error } = await supabase
        .from('feed_likes')
        .insert({ feed_item_id: itemId, athlete_id: athleteId });
      // A double-tap race hits the UNIQUE(feed_item_id, athlete_id) constraint;
      // that's already the desired end state, so treat it as success.
      if (error && error.code !== '23505') throw error;
      liked = true;

      // Only notify on the like, not on the un-like.
      void notifyFeedInteraction({
        feedItemId: itemId,
        authorAthleteId: meta.authorAthleteId,
        actorAthleteId: athleteId,
        actorName: auth.user.name,
        kind: 'like',
      });
    }

    // Read the trigger-maintained count back so the client never has to guess, and
    // the refreshed preview with it — otherwise the "תל ועוד 3" line would have to
    // invent the caller's own name to stay in sync after an optimistic toggle.
    const [{ data: item }, { data: topLikes }] = await Promise.all([
      supabase.from('feed_items').select('like_count').eq('id', itemId).maybeSingle(),
      supabase
        .from('feed_likes')
        .select(LIKER_SELECT)
        .eq('feed_item_id', itemId)
        .order('created_at', { ascending: false })
        .limit(LIKE_PREVIEW_COUNT),
    ]);

    const likePreview = ((topLikes || []) as unknown as RawLikeRow[])
      .map(projectLiker)
      .filter((l): l is FeedLiker => l !== null);

    return NextResponse.json({ liked, likeCount: item?.like_count ?? 0, likePreview });
  } catch (err: unknown) {
    console.error('Feed like error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
