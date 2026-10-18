import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { FEED_SELECT, projectFeedItem, type FeedItem } from '@/lib/feed/project';
import { loadFeedContext } from '@/lib/feed/context';
import { isCelebrationActive, toCelebration, type Celebration } from '@/lib/feed/celebration';
import { israelToday } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export interface CelebrationEntry {
  item: FeedItem;
  celebration: Celebration;
  honorees: Array<{ id: string; name: string; avatarUrl: string | null }>;
}

// GET /api/feed/celebrations -> { today, entries: CelebrationEntry[] }
//   The row of circles at the top of the feed (Ofer, 2026-10-18: "always at the top,
//   valid for that day, or longer when we say so"). Every celebration active today,
//   newest first, each with the same likes/comments context the feed builds and the
//   people it is for (their real photo is the circle). Any member.
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  try {
    const supabase = createServerClient();
    const today = israelToday();
    // A celebration can run for days, but never from further back than a month.
    const since = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const { data, error } = await supabase.from('feed_items').select(FEED_SELECT)
      .eq('type', 'announcement').is('deleted_at', null).gte('occurred_at', since)
      .order('occurred_at', { ascending: false }).limit(200);
    if (error) throw error;
    const rows = (data || []).filter((r) => isCelebrationActive((r as { payload: Record<string, unknown> | null }).payload, today));
    if (rows.length === 0) return NextResponse.json({ today, entries: [] });

    const context = await loadFeedContext(supabase, rows, { athleteId: auth.user.athleteId, isStaff: auth.user.isStaff });
    const items = rows.map((r) => projectFeedItem(r, context));
    const ids = [...new Set(items.flatMap((i) => toCelebration(i.payload)?.honorees ?? []))];
    const { data: people } = ids.length
      ? await supabase.from('athletes').select('id, name, avatar_url').in('id', ids)
      : { data: [] as Array<{ id: string; name: string | null; avatar_url: string | null }> };
    const byId = new Map((people || []).map((p) => [p.id, { id: p.id, name: p.name || '', avatarUrl: p.avatar_url ?? null }]));

    const entries: CelebrationEntry[] = items.map((item) => {
      const celebration = toCelebration(item.payload)!;
      return { item, celebration, honorees: celebration.honorees.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p) };
    });
    return NextResponse.json({ today, entries });
  } catch (err) {
    console.error('[feed/celebrations] failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
