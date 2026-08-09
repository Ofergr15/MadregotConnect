import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, authError } from '@/lib/auth-session';
import { FEED_SELECT, projectFeedItem } from '@/lib/feed/project';

export const dynamic = 'force-dynamic';

const MAX_BODY_LENGTH = 5000;
const MAX_IMAGES = 4;

/**
 * POST /api/feed/posts  { body?, media?: [{ path, url, w, h }] }
 *
 * A free member post — text, images, or both (PRD §10). The "just finished an ice
 * bath" case: not tied to any run.
 *
 * Media is uploaded separately via /api/feed/media first, so the composer can show
 * thumbnails and upload progress before the post is committed, and a failed upload
 * never loses typed text.
 */
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const payload = await request.json();
    const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
    const rawMedia = Array.isArray(payload?.media) ? payload.media : [];

    if (body.length > MAX_BODY_LENGTH) {
      return NextResponse.json(
        { error: `Post is too long (max ${MAX_BODY_LENGTH})` },
        { status: 400 },
      );
    }
    if (rawMedia.length > MAX_IMAGES) {
      return NextResponse.json({ error: `Up to ${MAX_IMAGES} images per post` }, { status: 400 });
    }

    // Re-validate the media descriptors rather than trusting the client's shape, and
    // keep only images that really live in our bucket — otherwise a crafted request
    // could make the feed render arbitrary remote URLs.
    const media = rawMedia
      .map((m: unknown) => {
        const rec = m as { path?: unknown; url?: unknown; w?: unknown; h?: unknown };
        if (typeof rec?.url !== 'string' || typeof rec?.path !== 'string') return null;
        if (!rec.url.includes('/storage/v1/object/public/feed-media/')) return null;
        return {
          path: rec.path,
          url: rec.url,
          w: typeof rec.w === 'number' ? rec.w : null,
          h: typeof rec.h === 'number' ? rec.h : null,
        };
      })
      .filter(Boolean);

    // A post with neither text nor a usable image is not a post.
    if (!body && media.length === 0) {
      return NextResponse.json({ error: 'Add some text or a photo' }, { status: 400 });
    }

    const supabase = createServerClient();
    const now = new Date().toISOString();

    const { data: created, error } = await supabase
      .from('feed_items')
      .insert({
        type: 'post',
        author_athlete_id: auth.user.athleteId,
        body: body || null,
        media: media.length > 0 ? media : null,
        occurred_at: now,
        group_id: auth.user.groupId,
      })
      .select(FEED_SELECT)
      .single();
    if (error) throw error;

    const item = projectFeedItem(created as never, {
      viewerAthleteId: auth.user.athleteId,
      viewerIsStaff: auth.user.isStaff,
      likedItemIds: new Set<string>(),
    });

    return NextResponse.json({ item });
  } catch (err: unknown) {
    console.error('Feed post create error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}

/**
 * DELETE /api/feed/posts?id=… — soft-delete own post; staff may delete any.
 *
 * Only type='post' is deletable: activity items are generated from Garmin syncs and
 * would simply reappear, so hiding a run is a visibility concern, not a delete.
 */
export async function DELETE(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const supabase = createServerClient();
    const { data: item } = await supabase
      .from('feed_items')
      .select('id, type, author_athlete_id, deleted_at')
      .eq('id', id)
      .maybeSingle();

    if (!item || item.deleted_at) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
    if (item.type !== 'post') {
      return NextResponse.json({ error: 'Only posts can be deleted' }, { status: 400 });
    }
    if (item.author_athlete_id !== auth.user.athleteId && !auth.user.isStaff) {
      return NextResponse.json({ error: 'Not allowed to delete this post' }, { status: 403 });
    }

    const { error } = await supabase
      .from('feed_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('Feed post delete error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
