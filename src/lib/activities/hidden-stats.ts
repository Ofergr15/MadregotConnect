import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The share sheet's "פרטים מוסתרים" (ActivitySyncEditor) applied OUTSIDE the feed.
 *
 * `feed_items.payload.hiddenFields` is enforced for the feed in lib/feed/project.ts
 * (`maskHiddenStats`). Since 2026-09-03 the run's detail, trace and analysis are
 * member-visible too, so a stat the runner hid from the club must not come back on
 * those screens either. This module answers one question for those routes: which of
 * pace / heart rate / calories did the runner hide on this run?
 *
 * Scope (owner-approved 2026-11-21): pace, heart_rate and calories only, withheld from
 * viewers who are NOT the runner and NOT staff (`mayActFor`). The runner and staff keep
 * everything. Totals of distance and time stay for everyone, as on the feed card.
 */
export const MASKED_STATS = ['pace', 'heart_rate', 'calories'] as const;
export type MaskedStat = (typeof MASKED_STATS)[number];

export function parseHiddenStats(raw: unknown): Set<MaskedStat> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((v): v is MaskedStat => (MASKED_STATS as readonly unknown[]).includes(v)));
}

/**
 * The hidden stats on one activity's feed item. No feed item = nothing hidden (there was
 * no share sheet to hide anything in). A failed read FAILS CLOSED: every masked stat is
 * treated as hidden, because "we could not tell" must not publish what the runner hid.
 */
export async function readHiddenStats(db: SupabaseClient, activityId: string): Promise<Set<MaskedStat>> {
  try {
    const { data, error } = await db.from('feed_items').select('payload').eq('activity_id', activityId).limit(1);
    if (error) return new Set(MASKED_STATS);
    const payload = (data?.[0] as { payload?: { hiddenFields?: unknown } | null } | undefined)?.payload;
    return parseHiddenStats(payload?.hiddenFields);
  } catch {
    return new Set(MASKED_STATS);
  }
}
