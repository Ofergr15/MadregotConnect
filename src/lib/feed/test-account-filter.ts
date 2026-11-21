import type { SupabaseClient } from '@supabase/supabase-js';
import { testAccountIds, hiddenTestAccountsFor } from '@/lib/athletes/test-accounts';

/**
 * Test accounts (migration 182) on likes and comments: a test account's like or
 * comment on a real member's item is hidden from other non-staff viewers, and the
 * counts shown beside the lists drop it too, so "3 likes" never sits above two faces.
 *
 * `feed_items.like_count` / `comment_count` are trigger-maintained totals, so the
 * visible count is the total minus the hidden rows on that item. Fails open with
 * `testAccountIds`: no column, no hidden ids, no extra query.
 */

type Db = SupabaseClient;

export async function hiddenInteractorsFor(
  db: Db,
  viewer: { athleteId?: string | null; isStaff?: boolean },
): Promise<Set<string>> {
  if (viewer.isStaff) return new Set();
  return hiddenTestAccountsFor(await testAccountIds(db), viewer);
}

/** feed_item_id -> rows by hidden athletes, in `feed_likes` or (live) `feed_comments`. */
export async function hiddenCountsByItem(
  db: Db,
  table: 'feed_likes' | 'feed_comments',
  itemIds: string[],
  hidden: Set<string>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (hidden.size === 0 || itemIds.length === 0) return counts;
  try {
    let q = db.from(table).select('feed_item_id, athlete_id').in('feed_item_id', itemIds).in('athlete_id', [...hidden]);
    if (table === 'feed_comments') q = q.is('deleted_at', null);
    const { data, error } = await q;
    if (error) return counts;
    for (const r of (data || []) as { feed_item_id: string; athlete_id: string }[]) {
      if (!hidden.has(r.athlete_id)) continue;
      counts.set(r.feed_item_id, (counts.get(r.feed_item_id) || 0) + 1);
    }
  } catch {
    // fail open: the stored total stands
  }
  return counts;
}

export function visibleCount(total: number | null | undefined, hiddenCount: number | undefined): number {
  return Math.max(0, (total ?? 0) - (hiddenCount ?? 0));
}

/** The athlete id on a LIKER_SELECT / COMMENT_SELECT row. */
export function interactorId(row: unknown): string | null {
  const r = row as { athlete_id?: string | null; athletes?: { id?: string | null } | null } | null;
  return r?.athlete_id ?? r?.athletes?.id ?? null;
}

export function withoutHiddenInteractors<T>(rows: T[], hidden: Set<string>): T[] {
  if (hidden.size === 0) return rows;
  return rows.filter((r) => {
    const id = interactorId(r);
    return !id || !hidden.has(id);
  });
}

/** Visible like/comment count for one item, for routes that return a fresh total. */
export async function visibleItemCount(
  db: Db,
  table: 'feed_likes' | 'feed_comments',
  itemId: string,
  total: number | null | undefined,
  viewer: { athleteId?: string | null; isStaff?: boolean },
): Promise<number> {
  const hidden = await hiddenInteractorsFor(db, viewer);
  const counts = await hiddenCountsByItem(db, table, [itemId], hidden);
  return visibleCount(total, counts.get(itemId));
}
