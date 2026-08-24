import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Kinds worth collapsing into "X and N others…" when they burst — low-content
// social pings where only the count matters. Deliberately excludes kinds
// whose body carries unique information a merge would destroy (a comment's
// actual text, a badge's name, a coach's actual reply, a teammate's specific
// run stats) — matching how Strava/Instagram themselves only ever collapse
// likes/follows, never comments or achievements.
const GROUPABLE_KINDS = new Set(['like', 'follow']);
const GROUP_VERB: Record<string, string> = {
  like: 'אהבו את הפוסט שלך ❤️',
  follow: 'התחילו לעקוב אחריך 👋',
};

interface RawItem {
  id: string; kind: string; title: string; body: string; url: string; sentAt: string; unread: boolean;
  actorName: string | null; actorAvatarUrl: string | null;
}

// Merge contiguous runs (already sorted newest-first) sharing the same
// kind+url into one row — e.g. 5 separate "X liked your post" rows on the
// same feed item become one "X and 4 others liked your post". Only ever
// merges ADJACENT items, so an old like from months ago can never absorb
// into today's burst just because they target the same url.
function aggregate(items: RawItem[]): RawItem[] {
  const result: RawItem[] = [];
  let i = 0;
  while (i < items.length) {
    const cur = items[i];
    if (!GROUPABLE_KINDS.has(cur.kind)) { result.push(cur); i++; continue; }
    let j = i + 1;
    while (j < items.length && items[j].kind === cur.kind && items[j].url === cur.url) j++;
    const run = items.slice(i, j);
    if (run.length === 1) {
      result.push(cur);
    } else {
      const others = run.length - 1;
      const who = cur.actorName || 'מישהו';
      result.push({
        ...cur,
        title: `${who} ו${others === 1 ? 'עוד אחד' : `${others} אחרים`} ${GROUP_VERB[cur.kind]}`,
      });
    }
    i = j;
  }
  return result;
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
    const rawItems: RawItem[] = (data || [])
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
    const items = aggregate(rawItems);

    return NextResponse.json({ items, unread: items.filter((i) => i.unread).length });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message, items: [], unread: 0 }, { status: 500 });
  }
}
