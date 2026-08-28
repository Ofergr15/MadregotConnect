import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

/**
 * Club-wide mutual follows.
 *
 * Replaces the earlier group-scoped version (lib/follows/group-sync.ts). The
 * follow graph exists to feed notifyTeammatesOfActivity — which queries
 * athlete_follows and returns early when nobody follows you — so scoping it to
 * a pace group meant most runs notified nobody at all: of 31 activities in the
 * first real sync, 26 reached zero people, because their author's group had no
 * other members with a follow row. Madregot is one club of ~20 people who all
 * train together; "everyone sees everyone" is the actual social model.
 *
 * Silent, inherited from the group version and now more important, not less: a
 * full reconcile creates hundreds of rows at once, and a "started following
 * you" push per row would be pure spam. Real follows (POST
 * /api/athletes/follow) still notify.
 */

export interface FollowRow {
  follower_id: string;
  followee_id: string;
}

/**
 * Every mutual pair among `athleteIds`, as directed rows — n*(n-1) of them.
 * Pure; exported for tests.
 */
export function buildClubFollowRows(athleteIds: string[]): FollowRow[] {
  const unique = [...new Set(athleteIds)];
  const rows: FollowRow[] = [];
  for (const a of unique) {
    for (const b of unique) {
      if (a !== b) rows.push({ follower_id: a, followee_id: b });
    }
  }
  return rows;
}

/**
 * Both directions between one athlete and every other club member — the
 * incremental case (someone new joins, or changes group). Pure; exported for
 * tests.
 */
export function buildFollowRowsForAthlete(athleteId: string, clubIds: string[]): FollowRow[] {
  const others = [...new Set(clubIds)].filter((id) => id !== athleteId);
  return others.flatMap((id) => [
    { follower_id: athleteId, followee_id: id },
    { follower_id: id, followee_id: athleteId },
  ]);
}

// Postgrest rejects very large single payloads; the club is ~20 people (≈380
// rows) today, but a reconcile is O(n²) so chunk rather than assume it stays
// small.
const CHUNK = 500;

async function insertFollowRows(
  supabase: ReturnType<typeof createServerClient>,
  rows: FollowRow[],
): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('athlete_follows')
      .upsert(chunk, { onConflict: 'follower_id,followee_id', ignoreDuplicates: true });
    // athlete_follows (migration 060) may not be applied in this environment —
    // follows are an enhancement to notifications, never a reason to fail the
    // signup/group-change write that triggered this.
    if (error) return written;
    written += chunk.length;
  }
  return written;
}

/** Active club members (coach's roster), including the coach themselves. */
async function activeClubIds(
  supabase: ReturnType<typeof createServerClient>,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('athletes')
    .select('id')
    .eq('coach_id', COACH_ID)
    .eq('status', 'active');
  if (error) return [];
  return (data || []).map((r: { id: string }) => r.id);
}

/**
 * Mutually follows one athlete with every other active club member. Call after
 * any write that creates an athlete or changes their group. Safe to call
 * repeatedly — the upsert ignores duplicates.
 */
export async function syncClubFollows(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
): Promise<void> {
  const clubIds = await activeClubIds(supabase);
  const rows = buildFollowRowsForAthlete(athleteId, clubIds);
  if (rows.length === 0) return;
  await insertFollowRows(supabase, rows);
}

/**
 * Fills in every missing mutual follow across the whole active club. Runs from
 * the daily badge cron: athletes go active/inactive through paths that don't
 * all funnel through syncClubFollows (admin edits, direct SQL, a status flip),
 * so a periodic reconcile is what actually keeps the graph complete.
 */
export async function reconcileClubFollows(
  supabase: ReturnType<typeof createServerClient>,
): Promise<{ athletes: number; rows: number }> {
  const clubIds = await activeClubIds(supabase);
  if (clubIds.length < 2) return { athletes: clubIds.length, rows: 0 };
  const rows = buildClubFollowRows(clubIds);
  const written = await insertFollowRows(supabase, rows);
  return { athletes: clubIds.length, rows: written };
}
