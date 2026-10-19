import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { FEED_SELECT, projectFeedItem, type FeedItem } from '@/lib/feed/project';
import { loadFeedContext } from '@/lib/feed/context';
import { isCelebrationActive, toCelebration, type Celebration } from '@/lib/feed/celebration';
import { israelToday } from '@/lib/utils';
import { israelDateOf } from '@/lib/reports/last-7-days';
import { readConfig as readBirthdayConfig } from '@/lib/birthday-year/server';

import { birthdayBodyAsOf } from '@/lib/feed/birthday';
import { CLUB_STORIES_KEY, activeClubStories, readClubStories } from '@/lib/feed/club-stories';

export const dynamic = 'force-dynamic';

export interface CelebrationEntry {
  item: FeedItem;
  celebration: Celebration;
  honorees: Array<{ id: string; name: string; avatarUrl: string | null }>;
}

// GET /api/feed/celebrations -> { today, entries: CelebrationEntry[], club: { id, title, text }[] }
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
    const rows = (data || []).filter((r) => {
      const row = r as { payload: Record<string, unknown> | null; occurred_at: string };
      return isCelebrationActive(row.payload, today, israelDateOf(row.occurred_at));
    });
    // The Madregot circle (lib/feed/club-stories.ts): read alongside, first on the row.
    const { data: storiesRow } = await supabase.from('app_settings').select('value').eq('key', CLUB_STORIES_KEY).maybeSingle();
    const club = activeClubStories(readClubStories((storiesRow as { value?: string } | null)?.value), today)
      .map(({ id, title, text }) => ({ id, title, text }));
    if (rows.length === 0) return NextResponse.json({ today, entries: [], club });

    const context = await loadFeedContext(supabase, rows, { athleteId: auth.user.athleteId, isStaff: auth.user.isStaff });
    const items = rows.map((r) => projectFeedItem(r, context));
    const ids = [...new Set(items.flatMap((i) => toCelebration(i.payload)?.honorees ?? []))];
    const { data: people } = ids.length
      ? await supabase.from('athletes').select('id, name, avatar_url').in('id', ids)
      : { data: [] as Array<{ id: string; name: string | null; avatar_url: string | null }> };
    const byId = new Map((people || []).map((p) => [p.id, { id: p.id, name: p.name || '', avatarUrl: p.avatar_url ?? null }]));

    // A birthday whose story has a Hebrew name ("שליו") shows it on the circle and in the
    // greeting; the roster name stays Latin (Ofer, 2026-10-18: "שהכל יהיה שליו").
    const hebrew = new Map<string, string>();
    await Promise.all(items.map(async (item) => {
      const p = (item.payload || {}) as { birthdayOf?: unknown; date?: unknown };
      if (typeof p.birthdayOf !== 'string' || typeof p.date !== 'string') return;
      const name = (await readBirthdayConfig(supabase, p.birthdayOf, p.date).catch(() => ({ displayName: null }))).displayName?.trim();
      if (name) hebrew.set(p.birthdayOf, name);
    }));
    const renamed = (body: string | null) => body && hebrew.size
      ? body.replace(/@\[([^\]]+)\]\(([0-9a-f-]{36})\)/gi, (m, _n: string, id: string) => (hebrew.has(id) ? `@[${hebrew.get(id)}](${id})` : m))
      : body;

    const entries: CelebrationEntry[] = items.map((item) => {
      const celebration = toCelebration(item.payload)!;
      const honorees = celebration.honorees.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => (hebrew.has(p.id) ? { ...p, name: hebrew.get(p.id)! } : p));
      const body = birthdayBodyAsOf(renamed(item.body) ?? item.body, (item.payload as Record<string, unknown> | null)?.date, today);
      return { item: { ...item, body }, celebration, honorees };
    });
    return NextResponse.json({ today, entries, club });
  } catch (err) {
    console.error('[feed/celebrations] failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
