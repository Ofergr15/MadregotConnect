import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, authError } from '@/lib/auth-session';
import { notifyFeedInteraction, loadFeedItemMeta } from '@/lib/feed/notify';
import {
  LIKER_SELECT,
  LIKE_PREVIEW_COUNT,
  projectLike,
} from '@/lib/feed/project';

export const dynamic = 'force-dynamic';

/** POST /api/feed/like  { itemId } */
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

      await notifyFeedInteraction({
        feedItemId: itemId,
        authorAthleteId: meta.authorAthleteId,
        actorAthleteId: athleteId,
        actorName: auth.user.name,
        kind: 'like',
      });
    }

    const [{ data: item }, { data: topLikes }] = await Promise.all([
      supabase.from('feed_items').select('like_count').eq('id', itemId).maybeSingle(),
      supabase
        .from('feed_likes')
        .select(LIKER_SELECT)
        .eq('feed_item_id', itemId)
        .order('created_at', { ascending: false })
        .limit(LIKE_PREVIEW_COUNT),
    ]);

    const likePreview = (topLikes || [])
      .map(projectLike)
      .filter(projected => projected !== null)
      .map(projected => projected.liker);

    return NextResponse.json({ liked, likeCount: item?.like_count ?? 0, likePreview });
  } catch (err: unknown) {
    console.error('Feed like error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
