import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { FEED_SELECT, projectFeedItem, type FeedItem } from '@/lib/feed/project';
import { clampFeedLimit, parseFeedCursor } from '@/lib/feed/pagination';
import { loadFeedContext } from '@/lib/feed/context';
import { parseSquadParam } from '@/lib/feed/squad-filter';

export const dynamic = 'force-dynamic';

/** The feed item types a caller may ask for via `?types=`. Whitelisted rather
 *  than passed through, so the param can't be used to probe for other values. */
const FILTERABLE_TYPES = ['activity', 'post', 'achievement', 'announcement', 'new_plan'];

/**
 * GET /api/feed?cursor=<occurredAt>,<id>&limit=20&types=announcement,post&squad=<groupId|academy>
 *
 * The club feed: runs and member posts interleaved, newest first.
 *
 * Keyset (not offset) pagination on (occurred_at DESC, id DESC) — matching
 * idx_feed_items_occurred. Offset pagination would skip or duplicate items whenever a
 * new run syncs mid-scroll, which on an active club feed is constantly.
 *
 * `types` is an optional comma-separated filter. It exists for the Profile
 * screen's עידכונים deck, which needs the latest *announcements* only — reading
 * the first page of the whole feed and filtering client-side would silently show
 * nothing whenever the newest 20 items happen to be runs, which on an active
 * club is most of the time. Unknown values are dropped; a `types` that names
 * nothing valid is treated as absent rather than as "match none", so a typo
 * degrades to the full feed instead of an unexplained empty screen.
 */
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);

  try {
    const { searchParams } = new URL(request.url);
    const limit = clampFeedLimit(searchParams.get('limit'));

    const types = (searchParams.get('types') || '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => FILTERABLE_TYPES.includes(t));

    let parsedCursor;
    try {
      parsedCursor = parseFeedCursor(searchParams.get('cursor'));
    } catch {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Squad narrowing (373ebe89). Server-side for the same reason `types` is: a
    // page of 20 that happens to be all Group A runs would come back empty after
    // client-side filtering, and on this club's feed that is most mornings.
    //
    // Resolved to a list of athlete ids rather than joined through
    // `athletes.group_id` in the select, because PostgREST cannot filter the
    // OUTER rows on an embedded resource without turning the embed into an inner
    // join — which would also drop every announcement and every post whose author
    // row is missing, silently changing what "the feed" means for the unfiltered
    // case. Two dozen ids is a cheap `in`.
    const squad = parseSquadParam(searchParams.get('squad'));
    let squadAuthorIds: string[] | null = null;
    if (squad) {
      const scope = supabase.from('athletes').select('id');
      const { data: members, error: membersError } =
        squad.kind === 'academy' ? await scope.eq('is_academy', true) : await scope.eq('group_id', squad.groupId);
      if (membersError) throw membersError;
      squadAuthorIds = (members || []).map((m: { id: string }) => m.id);
      // A real squad that nobody is in: "nobody there has posted" is the true
      // answer, and an empty `in()` is not something to hand PostgREST.
      if (squadAuthorIds.length === 0) return NextResponse.json({ items: [], nextCursor: null });
    }

    let query = supabase
      .from('feed_items')
      .select(FEED_SELECT)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1); // one extra row tells us whether more pages exist

    if (types.length > 0) query = query.in('type', types);
    if (squadAuthorIds) query = query.in('author_athlete_id', squadAuthorIds);

    // Cursor is "<iso timestamp>,<uuid>": strictly-after in the composite sort order.
    if (parsedCursor) {
      query = parsedCursor.id
        ? query.or(
            `occurred_at.lt.${parsedCursor.time},and(occurred_at.eq.${parsedCursor.time},id.lt.${parsedCursor.id})`,
          )
        : query.lt('occurred_at', parsedCursor.time);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    const page = (rows || []).slice(0, limit);
    const hasMore = (rows || []).length > limit;

    // Likes, comment previews and plan verdicts for the whole page — see
    // lib/feed/context.ts, which the single-item route uses too so a card opened
    // from a notification carries the same state as the same card in the feed.
    const ctx = await loadFeedContext(supabase, page, {
      athleteId: auth.user.athleteId,
      isStaff: auth.user.isStaff,
    });

    const items: FeedItem[] = page.map((row) => projectFeedItem(row, ctx));

    const last = page[page.length - 1] as { occurred_at: string; id: string } | undefined;
    const nextCursor = hasMore && last ? `${last.occurred_at},${last.id}` : null;

    return NextResponse.json({ items, nextCursor });
  } catch (err: unknown) {
    console.error('Feed fetch error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed to load feed' }, { status: 500 });
  }
}
