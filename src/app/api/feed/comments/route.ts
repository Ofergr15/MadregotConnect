import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, requireAthlete, authError } from '@/lib/auth-session';
import { notifyFeedInteraction, loadFeedItemMeta } from '@/lib/feed/notify';

export const dynamic = 'force-dynamic';

const MAX_COMMENT_LENGTH = 1000;

const COMMENT_SELECT = `
  id, feed_item_id, athlete_id, body, created_at,
  athletes ( id, name, avatar_url )
`;

interface RawComment {
  id: string;
  feed_item_id: string;
  athlete_id: string;
  body: string;
  created_at: string;
  athletes?: { id: string; name: string | null; avatar_url: string | null } | null;
}

function projectComment(
  value: unknown,
  viewerAthleteId: string | null,
  viewerIsStaff: boolean,
) {
  const row = value as RawComment;
  return {
    id: row.id,
    itemId: row.feed_item_id,
    body: row.body,
    createdAt: row.created_at,
    author: {
      athleteId: row.athlete_id,
      name: row.athletes?.name || 'Unknown',
      avatarUrl: row.athletes?.avatar_url || null,
    },
    // Author may remove their own; staff may remove any (moderation, PRD §19).
    canDelete: viewerIsStaff || row.athlete_id === viewerAthleteId,
  };
}

/** GET /api/feed/comments?itemId=… — flat, oldest first (reads like a conversation). */
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);

  try {
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('itemId');
    if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('feed_comments')
      .select(COMMENT_SELECT)
      .eq('feed_item_id', itemId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw error;

    const comments = (data || []).map((row) =>
      projectComment(row, auth.user.athleteId, auth.user.isStaff),
    );
    return NextResponse.json({ comments });
  } catch (err: unknown) {
    console.error('Feed comments fetch error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}

/** POST /api/feed/comments  { itemId, body } */
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const payload = await request.json();
    const itemId = payload?.itemId;
    const body = typeof payload?.body === 'string' ? payload.body.trim() : '';

    if (!itemId || typeof itemId !== 'string') {
      return NextResponse.json({ error: 'itemId required' }, { status: 400 });
    }
    if (!body) return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 });
    if (body.length > MAX_COMMENT_LENGTH) {
      return NextResponse.json(
        { error: `Comment is too long (max ${MAX_COMMENT_LENGTH})` },
        { status: 400 },
      );
    }

    const meta = await loadFeedItemMeta(itemId);
    if (!meta) return NextResponse.json({ error: 'Feed item not found' }, { status: 404 });

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('feed_comments')
      .insert({ feed_item_id: itemId, athlete_id: auth.user.athleteId, body })
      .select(COMMENT_SELECT)
      .single();
    if (error) throw error;

    await notifyFeedInteraction({
      feedItemId: itemId,
      authorAthleteId: meta.authorAthleteId,
      actorAthleteId: auth.user.athleteId,
      actorName: auth.user.name,
      kind: 'comment',
      commentBody: body,
    });

    const { data: item } = await supabase
      .from('feed_items')
      .select('comment_count')
      .eq('id', itemId)
      .maybeSingle();

    return NextResponse.json({
      comment: projectComment(data, auth.user.athleteId, auth.user.isStaff),
      commentCount: item?.comment_count ?? 0,
    });
  } catch (err: unknown) {
    console.error('Feed comment create error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}

/** DELETE /api/feed/comments?id=… — own comment, or any comment if staff. */
export async function DELETE(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const supabase = createServerClient();
    const { data: comment } = await supabase
      .from('feed_comments')
      .select('id, athlete_id, feed_item_id, deleted_at')
      .eq('id', id)
      .maybeSingle();

    if (!comment || comment.deleted_at) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }
    if (comment.athlete_id !== auth.user.athleteId && !auth.user.isStaff) {
      return NextResponse.json({ error: 'Not allowed to delete this comment' }, { status: 403 });
    }

    const { error } = await supabase
      .from('feed_comments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;

    const { data: item } = await supabase
      .from('feed_items')
      .select('comment_count')
      .eq('id', comment.feed_item_id)
      .maybeSingle();

    return NextResponse.json({ success: true, commentCount: item?.comment_count ?? 0 });
  } catch (err: unknown) {
    console.error('Feed comment delete error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
