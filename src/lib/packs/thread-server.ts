import type { SupabaseClient } from '@supabase/supabase-js';
import { academyManagerSeatIds } from '@/lib/academy/thread-server';
import { packLeaderIds, packMembers } from './server';

/**
 * Who sits in a pack's chat: its active members, its leaders, every active club coach
 * (role coach / academy_coach; a removed coach leaves) and the manager seat. Null = no such pack.
 */
export async function packThreadMembers(db: SupabaseClient, packId: string): Promise<string[] | null> {
  const { data: pack } = await db.from('groups').select('id').eq('id', packId).maybeSingle();
  if (!pack) return null;
  const [members, leaders, { data: coaches }, managers] = await Promise.all([
    packMembers(db, packId),
    packLeaderIds(db, packId),
    db.from('athletes').select('id, status').in('role', ['coach', 'academy_coach']),
    academyManagerSeatIds(db),
  ]);
  return [...new Set([
    ...members.map((m) => m.athleteId), ...leaders,
    ...((coaches || []) as Array<{ id: string; status?: string | null }>)
      .filter((c) => (c.status ?? 'active') === 'active').map((c) => c.id), ...managers,
  ])].filter(Boolean);
}
