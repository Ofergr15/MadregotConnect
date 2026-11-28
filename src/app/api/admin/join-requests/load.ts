import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import type { SuggestGroupInput } from '@/lib/join/suggest-group';

type Db = ReturnType<typeof createServerClient>;

/** The club's packs with their marathon goal, as the sign-up form reads them. */
export async function loadPackGoals(db: Db): Promise<SuggestGroupInput[]> {
  const { data, error } = await db.from('groups').select('id, name, pace_profile').eq('coach_id', COACH_ID);
  if (error) return [];
  return ((data || []) as Array<{ id: string; name: string; pace_profile: { marathonGoal?: string } | null }>).map((g) => ({
    id: g.id, name: g.name, marathonGoal: g.pace_profile?.marathonGoal ?? null,
  }));
}
