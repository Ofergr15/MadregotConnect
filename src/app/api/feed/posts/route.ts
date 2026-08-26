import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, requireSession, authError } from '@/lib/auth-session';
import { FEED_SELECT, projectFeedItem } from '@/lib/feed/project';
import { sanitizeMediaList } from '@/lib/feed/media';
import { resolveAudience, sendPushToSubscriptions } from '@/lib/push';

export const dynamic = 'force-dynamic';

const MAX_BODY_LENGTH = 5000;
const MAX_IMAGES = 4;

/** POST /api/feed/posts  { body?, media?: [{ path, url, w, h }] } */
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const payload = await request.json();
    const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
    const rawMedia: unknown[] = Array.isArray(payload?.media) ? payload.media : [];

    if (body.length > MAX_BODY_LENGTH) {
      return NextResponse.json(
        { error: `Post is too long (max ${MAX_BODY_LENGTH})` },
        { status: 400 },
      );
    }
    if (rawMedia.length > MAX_IMAGES) {
      return NextResponse.json({ error: `Up to ${MAX_IMAGES} images per post` }, { status: 400 });
    }

    const supabase = createServerClient();
    const media = sanitizeMediaList(rawMedia, auth.user.athleteId).map((m) => ({
      ...m,
      url: supabase.storage.from('feed-media').getPublicUrl(m.path).data.publicUrl,
    }));

    if (!body && media.length === 0) {
      return NextResponse.json({ error: 'Add some text or a photo' }, { status: 400 });
    }

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

    const item = projectFeedItem(created, {
      viewerAthleteId: auth.user.athleteId,
      viewerIsStaff: auth.user.isStaff,
      likedItemIds: new Set<string>(),
    });

    // Previously only a REACTION to a post ever notified anyone (the author,
    // on like/comment) — the post itself was silent to everyone else in the
    // group. Same "what my teammates are up to" bucket as feed reactions.
    try {
      if (auth.user.groupId) {
        const subs = (await resolveAudience('group', auth.user.groupId))
          .filter((s) => s.athlete_id !== auth.user.athleteId);
        if (subs.length > 0) {
          const preview = body.length > 80 ? `${body.slice(0, 80)}…` : body;
          await sendPushToSubscriptions(subs, {
            title: `${auth.user.name || 'מישהו'} פרסם/ה בפיד 📸`,
            body: preview || 'לחצו לצפייה',
            url: `/dashboard/feed?item=${created.id}`,
            tag: `feed-post-${created.id}`,
            category: 'teammates',
          });
        }
      }
    } catch {
      // best-effort — never let a push failure affect post creation
    }

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
  const auth = await requireSession(request);
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
