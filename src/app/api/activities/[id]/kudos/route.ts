import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { feedItemForActivity } from '@/lib/feed/likes';
import { notifyFeedInteraction } from '@/lib/feed/notify';
import { LIKER_SELECT, projectLike } from '@/lib/feed/project';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { ACTION_TOKEN_HEADER, kudosScope, verifyActionToken } from '@/lib/auth/action-token';

export const dynamic = 'force-dynamic';

/**
 * Kudos on a run, keyed by activity — the shape the push notification's 👍 and
 * the Notification Center row speak, because neither of them knows a feed item
 * id. The storage underneath is `feed_likes`, the same row the ❤️ on the feed
 * card writes (see lib/feed/likes.ts for why there used to be two tables and
 * what went wrong because of it).
 *
 * The response shape is unchanged — the service worker and
 * /dashboard/notifications call this exactly as before.
 */

/** How many givers' names/avatars the "Tal and 3 others" row needs. */
const GIVER_PREVIEW = 20;

const EMPTY = { count: 0, givenByMe: false, givers: [] };

// GET /api/activities/[id]/kudos?athleteId=… — kudos count, whether the
// caller already gave it, and who gave it (name + avatar, capped) so the UI
// can render a Strava-style "Tal and 3 others gave kudos" avatar row.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const athleteId = new URL(request.url).searchParams.get('athleteId');
    const supabase = createServerClient();

    // No feed item means the run predates the feed, so nobody can have reacted
    // to it. Same answer the old table gave for a run with no kudos rows.
    const item = await feedItemForActivity(supabase, id);
    if (!item) return NextResponse.json(EMPTY);

    const [{ data: counter }, { data, error }] = await Promise.all([
      supabase.from('feed_items').select('like_count').eq('id', item.id).maybeSingle(),
      supabase
        .from('feed_likes')
        .select(LIKER_SELECT)
        .eq('feed_item_id', item.id)
        .order('created_at', { ascending: false })
        .limit(GIVER_PREVIEW),
    ]);
    if (error) throw error;

    const likers = (data || [])
      .map(projectLike)
      .filter((projected) => projected !== null)
      .map((projected) => projected.liker);

    return NextResponse.json({
      // The true total, from the counter the trigger maintains — not the length
      // of the capped preview, which is what this used to report and which
      // undercounted any run with more than 20 kudos.
      count: counter?.like_count ?? likers.length,
      givenByMe: !!athleteId && likers.some((liker) => liker.athleteId === athleteId),
      givers: likers.map((liker) => ({ name: liker.name, avatarUrl: liker.avatarUrl })),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message, ...EMPTY }, { status: 500 });
  }
}

// POST /api/activities/[id]/kudos { athleteId } — give kudos. Idempotent: a
// repeat call is a no-op, not an error (unlike POST /api/feed/like, which
// toggles — a notification's 👍 button has no way to know the current state, so
// it must not be able to take a kudos away).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { athleteId } = await request.json();
    if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });

    // This route took the giver's identity straight from the body with no check
    // at all, so anyone could give kudos as anybody — which also fired a push at
    // the activity's owner naming whoever the caller claimed to be.
    //
    // Two legitimate callers, same split as /api/attendance: the in-app button
    // (verified session) and the 👍 button on a push notification, which runs in
    // the service worker and can't reach a session — that one carries a token
    // scoped to this athlete and this activity.
    const token = request.headers.get(ACTION_TOKEN_HEADER);
    if (!verifyActionToken(token, athleteId, kudosScope(id))) {
      const { denied, caller } = await resolveVerifiedCaller(request);
      if (denied) return denied;
      if (!mayActFor(caller, athleteId)) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
    }

    const supabase = createServerClient();
    const item = await feedItemForActivity(supabase, id);
    if (!item) {
      return NextResponse.json({ error: 'This run is not in the feed, so it cannot take kudos' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('feed_likes')
      .upsert(
        { feed_item_id: item.id, athlete_id: athleteId },
        { onConflict: 'feed_item_id,athlete_id', ignoreDuplicates: true },
      )
      .select('id');
    if (error) throw error;

    if ((data || []).length > 0) {
      // Genuinely new — tell the run's owner. Best-effort, never blocks the
      // kudos itself. Shared with the feed's own like path, so the athlete gets
      // one notification with one wording however the reaction arrived.
      try {
        const { data: giver } = await supabase.from('athletes').select('name').eq('id', athleteId).maybeSingle();
        await notifyFeedInteraction({
          feedItemId: item.id,
          authorAthleteId: item.authorAthleteId,
          actorAthleteId: athleteId,
          actorName: giver?.name?.trim() || '',
          kind: 'like',
          itemType: 'activity',
        });
      } catch { /* best-effort */ }
    }

    return NextResponse.json({ given: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/activities/[id]/kudos { athleteId } — un-kudos. Idempotent.
// Session-only, deliberately: no notification carries an un-kudos button, so
// there is no service-worker caller to accommodate here. Ungated, this removed
// anyone's reaction on anyone's activity.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { athleteId } = await request.json();
    if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });

    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!mayActFor(caller, athleteId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const supabase = createServerClient();
    const item = await feedItemForActivity(supabase, id);
    // Nothing to remove, and nothing wrong with asking: idempotent either way.
    if (!item) return NextResponse.json({ given: false });

    const { error } = await supabase
      .from('feed_likes')
      .delete()
      .eq('feed_item_id', item.id)
      .eq('athlete_id', athleteId);
    if (error) throw error;

    return NextResponse.json({ given: false });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
