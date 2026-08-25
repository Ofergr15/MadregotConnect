import { createServerClient } from '@/lib/supabase/server';

/**
 * Mutually follows an athlete with everyone else already in the same group,
 * so the follow-based 'teammates' push (notifyTeammatesOfActivity in push.ts)
 * reaches a training group by default instead of requiring everyone to
 * discover and tap Follow on each teammate one at a time. Call this right
 * after any write that sets/changes an athlete's group_id.
 *
 * Silent — unlike POST /api/athletes/follow, this never sends a "started
 * following you" push. A group-join backfill can create dozens of follow
 * rows in one call; notifying for every one of them would read as spam, not
 * a real social action worth surfacing.
 *
 * No-op if groupId is null/empty or the athlete has no groupmates yet.
 */
export async function syncGroupFollows(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  groupId: string | null | undefined,
): Promise<void> {
  if (!groupId) return;

  const { data: groupmates } = await supabase
    .from('athletes')
    .select('id')
    .eq('group_id', groupId)
    .neq('id', athleteId);
  const mateIds = (groupmates || []).map((g: { id: string }) => g.id);
  if (mateIds.length === 0) return;

  const rows = mateIds.flatMap((mateId) => [
    { follower_id: athleteId, followee_id: mateId },
    { follower_id: mateId, followee_id: athleteId },
  ]);

  await supabase
    .from('athlete_follows')
    .upsert(rows, { onConflict: 'follower_id,followee_id', ignoreDuplicates: true });
}
