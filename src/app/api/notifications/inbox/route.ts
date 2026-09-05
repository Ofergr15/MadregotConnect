import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import {
  UUID_RE,
  shapeInboxItem,
  aggregate,
  rowActionTargets,
  applyRowActions,
  rsvpKey,
  type RawItem,
} from '@/lib/notifications/inbox';
import { likedActivityIds } from '@/lib/feed/likes';
import { localeFromPrefs } from '@/lib/notifications/locale';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

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

// GET /api/notifications/inbox?athleteId=… → { items[], unread }
// The athlete's notification history: sent notifications targeting them (all /
// their group / them), newest first, each flagged read/unread against
// last_seen_at. Mirrors the audience-match logic in unreadCountForAthlete.
// Internal ledger rows (idempotency sentinels stashed with a #ledger: url) are
// excluded — they aren't member-facing messages.
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
      .select('group_id, last_seen_at, notification_prefs')
      .eq('id', athleteId)
      .maybeSingle();
    if (athleteError) throw athleteError;
    if (!a) return NextResponse.json({ items: [], unread: 0 });

    const orClause = [
      'audience_type.eq.all',
      a.group_id ? `and(audience_type.eq.group,audience_id.eq.${a.group_id})` : null,
      `and(audience_type.eq.athlete,audience_id.eq.${athleteId})`,
    ].filter(Boolean).join(',');

    // Ledger rows (idempotency sentinels, url LIKE '#ledger:%') must be
    // excluded HERE, before .limit(50) — not just in the JS filter below.
    // An active athlete can accumulate more than 50 ledger rows over time
    // (post-workout-prompt dedup, RSVP-reminder dedup, etc.), which used to
    // consume the entire page and hide every real notification behind them.
    let { data, error } = await supabase
      .from('scheduled_notifications')
      .select('id, kind, title_he, body_he, url, last_sent_at, actor_athlete_id, actor:actor_athlete_id ( name, avatar_url )')
      .eq('status', 'sent')
      .or(orClause)
      .not('url', 'like', '#ledger:%')
      .order('last_sent_at', { ascending: false })
      .limit(50)
      .returns<Record<string, any>[]>();
    if (error?.code === '42703' || error?.code === 'PGRST200') {
      // actor_athlete_id not migrated yet — degrade to the pre-071 shape.
      ({ data, error } = await supabase
        .from('scheduled_notifications')
        .select('id, kind, title_he, body_he, url, last_sent_at')
        .eq('status', 'sent')
        .or(orClause)
        .not('url', 'like', '#ledger:%')
        .order('last_sent_at', { ascending: false })
        .limit(50)
        .returns<Record<string, any>[]>());
    }
    if (error) throw error;

    const since = a.last_seen_at || '1970-01-01';
    const rawItems = (data || [])
      // Drop internal idempotency-ledger rows (not real member messages).
      .filter((r: any) => !String(r.url || '').startsWith('#ledger:'))
      .map((r: any) => shapeInboxItem(r, since));
    // Merged bursts are composed here rather than at send time, so they need
    // the athlete's notification language too.
    const aggregated = aggregate(rawItems, localeFromPrefs(a.notification_prefs));
    // After aggregate(), so a merged burst is asked about once rather than per
    // row it swallowed.
    const items = await withRowActions(supabase, athleteId, aggregated);

    return NextResponse.json({ items, unread: items.filter((i) => i.unread).length });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message, items: [], unread: 0 }, { status: 500 });
  }
}
