import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { isSuperUser } from '@/lib/constants';
import { UUID_RE, shapeInboxItem, aggregate } from '@/lib/notifications/inbox';
import { canViewAthleteNotifications } from '@/lib/notifications/access';

export const dynamic = 'force-dynamic';

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

    // Scoped auth identical to /api/athletes/summary and /prs: own athlete,
    // staff, or super-user — this was previously wide open (any athleteId in
    // the query string returned that athlete's full notification history,
    // including private one-on-one messages, with zero auth check).
    const supabase = createServerClient();
    const email = (request.headers.get('x-user-email') || '').toLowerCase().trim();
    const isSuper = isSuperUser(email);
    let caller: { id: string; role: string } | null = null;
    if (!isSuper && email) {
      const { data } = await supabase.from('athletes').select('id, role').eq('email', email).maybeSingle();
      caller = data as { id: string; role: string } | null;
    }
    if (!canViewAthleteNotifications({ isSuper, caller, athleteId })) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { data: a, error: athleteError } = await supabase
      .from('athletes')
      .select('group_id, last_seen_at')
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
    const items = aggregate(rawItems);

    return NextResponse.json({ items, unread: items.filter((i) => i.unread).length });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message, items: [], unread: 0 }, { status: 500 });
  }
}
