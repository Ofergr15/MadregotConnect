import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { FEED_SELECT, projectFeedItem } from '@/lib/feed/project';
import { loadFeedContext } from '@/lib/feed/context';
import { isMissingColumn } from '@/lib/publish/pin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/feed/pinned -> { items: Array<FeedItem & { pinnedUntil }> }
 *
 * The club's posts pinned to the top ("נעוץ בראש הפיד", mockup publish-preview-v2):
 * pinned_until still ahead, the newest pin first. The feed shows them above the list
 * and leaves them out of it. Club posts only (author null), so a member's own post
 * can never be made to sit on top. Before migration 160 there is no column: no pins.
 */
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  try {
    const db = createServerClient();
    const { data, error } = await db.from('feed_items').select(`${FEED_SELECT}, pinned_until`)
      .is('deleted_at', null).is('author_athlete_id', null)
      .gt('pinned_until', new Date().toISOString())
      .order('occurred_at', { ascending: false }).limit(3);
    if (error) {
      if (isMissingColumn(error)) return NextResponse.json({ items: [] });
      throw error;
    }
    const rows = (data || []) as unknown as Array<Record<string, unknown> & { pinned_until: string }>;
    if (!rows.length) return NextResponse.json({ items: [] });
    const ctx = await loadFeedContext(db, rows as never, { athleteId: auth.user.athleteId, isStaff: auth.user.isStaff });
    const items = rows.map((r) => ({ ...projectFeedItem(r as never, ctx), pinnedUntil: r.pinned_until }));
    return NextResponse.json({ items });
  } catch (err) {
    console.error('[feed/pinned] failed:', err);
    return NextResponse.json({ items: [] });
  }
}
