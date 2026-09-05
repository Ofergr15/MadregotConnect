import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, requireAthlete, authError } from '@/lib/auth-session';
import { notifyFeedInteraction, notifyMentions, loadFeedItemMeta } from '@/lib/feed/notify';
import { COMMENT_SELECT, projectComment, validateCommentBody } from '@/lib/feed/comments';

export const dynamic = 'force-dynamic';

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

    if (!itemId || typeof itemId !== 'string') {
      return NextResponse.json({ error: 'itemId required' }, { status: 400 });
    }
    const validation = validateCommentBody(payload?.body);
    if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
    const { body } = validation;

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
    await notifyMentions({ feedItemId: itemId, body, actorAthleteId: auth.user.athleteId, actorName: auth.user.name, kind: 'comment' });

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
