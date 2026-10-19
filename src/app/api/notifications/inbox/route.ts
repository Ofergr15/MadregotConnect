import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import {
  UUID_RE,
  shapeInboxItem,
  clearMutedUnread,
  clubPostItems,
  isPlaceholderRow,
  aggregate,
  rowActionTargets,
  applyRowActions,
  rsvpKey,
  type RawItem,
} from '@/lib/notifications/inbox';
import { likedActivityIds } from '@/lib/feed/likes';
import { localeFromPrefs } from '@/lib/notifications/locale';
import { isStaffRole, mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

const INBOX_WINDOW = 150;
const CLUB_POSTS_DAYS = 7;

/**
 * Resolve the interactive rows' own state — kudos already given, RSVP already
 * answered — in two queries for the whole page instead of one request per row
 * from the browser (see the row-actions section of lib/notifications/inbox.ts
 * for what that used to cost).
 *
 * Failures are swallowed on purpose: a lookup that didn't land leaves those
 * fields absent, and the row falls back to loading itself. Slow beats wrong,
 * and beats a 500 on a page whose actual content is already in hand.
 */
async function withRowActions(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  items: RawItem[],
): Promise<RawItem[]> {
  const { activityIds, weekStarts } = rowActionTargets(items);
  if (activityIds.length === 0 && weekStarts.length === 0) return items;

  const [kudosGiven, rsvps] = await Promise.all([
    // Kudos live in `feed_likes`, keyed by feed item — this resolves them back
    // to the activity ids the inbox rows are keyed on.
    activityIds.length ? likedActivityIds(supabase, athleteId, activityIds) : null,
    weekStarts.length
      ? supabase
          .from('workout_attendance')
          .select('week_start_date, day_of_week, attending')
          .eq('athlete_id', athleteId)
          .in('week_start_date', weekStarts)
          .returns<{ week_start_date: string; day_of_week: number; attending: boolean }[]>()
      : null,
  ]);

  let rsvpByKey: Map<string, boolean> | null = null;
  if (rsvps && !rsvps.error) {
    rsvpByKey = new Map(
      (rsvps.data || []).map((r) => [rsvpKey(r.week_start_date, Number(r.day_of_week)), !!r.attending]),
    );
  }

  return applyRowActions(items, { kudosGiven, rsvpByKey });
}

/** The week's club posts (feed announcements) merged in by time — the club tab's other half. */
async function withClubPosts(
  supabase: ReturnType<typeof createServerClient>,
  groupId: string | null,
  since: string,
  items: RawItem[],
): Promise<RawItem[]> {
  const weekAgo = new Date(Date.now() - CLUB_POSTS_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('feed_items')
    .select('id, body, occurred_at, group_id')
    .eq('type', 'announcement')
    .is('deleted_at', null)
    .gte('occurred_at', weekAgo)
    .order('occurred_at', { ascending: false })
    .limit(20);
  // Fail open: the inbox without the club's posts is still the inbox.
  if (error || !data) return items;
  const posts = data.filter((p: { group_id: string | null }) => !p.group_id || p.group_id === groupId);
  const pushed = new Set(items.filter((i) => i.toAll).map((i) => i.title.trim()));
  return [...items, ...clubPostItems(posts, since, pushed)].sort((x, y) => (y.sentAt || '').localeCompare(x.sentAt || ''));
}

// GET /api/notifications/inbox?athleteId=… → { items[], unread }
// The athlete's notification history: sent notifications targeting them (all /
// their group / them), newest first, each flagged read/unread against
// last_seen_at. Mirrors unreadCountForAthlete's rules — audience, ledger
// exclusion, and (since 2026-09-09) the muted-category rule, so the dots here
// and the number on the bell mean the same thing.
// Internal ledger rows (idempotency sentinels stashed with a #ledger: url) are
// excluded — they aren't member-facing messages.
//
// The `unread` total is over the AGGREGATED items, so a merged burst of five
// kudos counts once here and five times in the badge. That is the one remaining
// difference and it is intentional — the badge counts notifications, this counts
// rows the athlete would see. Nothing renders this number today (the bells both
// read /api/notifications/unread); it exists for callers that already have the
// page in hand.
export async function GET(request: Request) {
  try {
    const athleteId = new URL(request.url).searchParams.get('athleteId');
    if (!athleteId || !UUID_RE.test(athleteId)) return NextResponse.json({ items: [], unread: 0 });

    // Own athlete, staff, or super-user — resolved from the verified session.
    // The identity used to come from `x-user-email`, so any athleteId plus a
    // forged header returned that athlete's full notification history,
    // including private one-on-one messages.
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!mayActFor(caller, athleteId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const supabase = createServerClient();

    const { data: a, error: athleteError } = await supabase
      .from('athletes')
      // `role` for the mute rule below — see countsTowardBadge in push.ts.
      .select('group_id, role, is_academy, last_seen_at, notification_prefs')
      .eq('id', athleteId)
      .maybeSingle();
    if (athleteError) throw athleteError;
    if (!a) return NextResponse.json({ items: [], unread: 0 });

    const orClause = [
      'audience_type.eq.all',
      a.group_id ? `and(audience_type.eq.group,audience_id.eq.${a.group_id})` : null,
      a.is_academy ? 'audience_type.eq.academy' : null,
      `and(audience_type.eq.athlete,audience_id.eq.${athleteId})`,
    ].filter(Boolean).join(',');

    // Ledger rows (idempotency sentinels, url LIKE '#ledger:%') must be
    // excluded HERE, before .limit(50) — not just in the JS filter below.
    // An active athlete can accumulate more than 50 ledger rows over time
    // (post-workout-prompt dedup, RSVP-reminder dedup, etc.), which used to
    // consume the entire page and hide every real notification behind them.
    // 150, not 50: the page folds each day's "X finished a run" into one row
    // (lib/notifications/history foldRuns), and at ~30 of those a day a 50-row
    // window was under two days of history (Eyal, 2026-10-11).
    let { data, error } = await supabase
      .from('scheduled_notifications')
      .select('id, kind, title_he, body_he, url, last_sent_at, audience_type, actor_athlete_id, actor:actor_athlete_id ( name, avatar_url )')
      .eq('status', 'sent')
      .or(orClause)
      .not('url', 'like', '#ledger:%')
      .order('last_sent_at', { ascending: false })
      .limit(INBOX_WINDOW)
      .returns<Record<string, any>[]>();
    if (error?.code === '42703' || error?.code === 'PGRST200') {
      // actor_athlete_id not migrated yet — degrade to the pre-071 shape.
      ({ data, error } = await supabase
        .from('scheduled_notifications')
        .select('id, kind, title_he, body_he, url, last_sent_at, audience_type')
        .eq('status', 'sent')
        .or(orClause)
        .not('url', 'like', '#ledger:%')
        .order('last_sent_at', { ascending: false })
        .limit(INBOX_WINDOW)
        .returns<Record<string, any>[]>());
    }
    if (error) throw error;

    const since = a.last_seen_at || '1970-01-01';
    const rawItems = clearMutedUnread(
      (data || [])
        // Drop internal idempotency-ledger rows (not real member messages).
        .filter((r: any) => !String(r.url || '').startsWith('#ledger:') && !isPlaceholderRow(r))
        .map((r: any) => shapeInboxItem(r, since, { isStaff: isStaffRole(a.role) })),
      a.notification_prefs as Record<string, boolean> | null,
      isStaffRole(a.role),
      a.role,
    );
    // Merged bursts are composed here rather than at send time, so they need
    // the athlete's notification language too.
    const aggregated = aggregate(rawItems, localeFromPrefs(a.notification_prefs));
    // After aggregate(), so a merged burst is asked about once rather than per
    // row it swallowed.
    const withPosts = await withClubPosts(supabase, a.group_id, since, aggregated);
    const items = await withRowActions(supabase, athleteId, withPosts);

    return NextResponse.json({ items, unread: items.filter((i) => i.unread).length });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message, items: [], unread: 0 }, { status: 500 });
  }
}
