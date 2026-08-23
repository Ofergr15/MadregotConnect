import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

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
    if (!athleteId) return NextResponse.json({ items: [], unread: 0 });

    const supabase = createServerClient();
    const { data: a } = await supabase
      .from('athletes')
      .select('group_id, last_seen_at')
      .eq('id', athleteId)
      .maybeSingle();
    if (!a) return NextResponse.json({ items: [], unread: 0 });

    const orClause = [
      'audience_type.eq.all',
      a.group_id ? `and(audience_type.eq.group,audience_id.eq.${a.group_id})` : null,
      `and(audience_type.eq.athlete,audience_id.eq.${athleteId})`,
    ].filter(Boolean).join(',');

    let { data, error } = await supabase
      .from('scheduled_notifications')
      .select('id, kind, title_he, body_he, url, last_sent_at, actor_athlete_id, actor:actor_athlete_id ( name, avatar_url )')
      .eq('status', 'sent')
      .or(orClause)
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
        .order('last_sent_at', { ascending: false })
        .limit(50)
        .returns<Record<string, any>[]>());
    }
    if (error) throw error;

    const since = a.last_seen_at || '1970-01-01';
    const items = (data || [])
      // Drop internal idempotency-ledger rows (not real member messages).
      .filter((r: any) => !String(r.url || '').startsWith('#ledger:'))
      .map((r: any) => ({
        id: r.id,
        kind: r.kind,
        title: r.title_he,
        body: r.body_he,
        url: r.url && !r.url.startsWith('#') ? r.url : '/dashboard',
        sentAt: r.last_sent_at,
        unread: !!r.last_sent_at && r.last_sent_at > since,
        actorName: r.actor?.name || null,
        actorAvatarUrl: r.actor?.avatar_url || null,
      }));

    return NextResponse.json({ items, unread: items.filter((i) => i.unread).length });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message, items: [], unread: 0 }, { status: 500 });
  }
}
