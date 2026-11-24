import type { SupabaseClient } from '@supabase/supabase-js';
import { mayActFor, type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { isAcademyManager } from '@/lib/academy/pairing-server';
import { coachIdsOf } from '@/lib/academy/trainee-coaches';
import { raceSeat, type RaceSeat } from './races';

/** `mayActFor` first, then narrowed to the athlete's own coaches (races.ts `raceSeat`). */
export async function resolveRaceSeat(db: SupabaseClient, caller: VerifiedCaller, athleteId: string): Promise<RaceSeat | null> {
  if (!mayActFor(caller, athleteId)) return null;
  if (caller.athleteId === athleteId) return 'self';
  const manager = isAcademyManager(caller);
  if (manager) return 'manager';
  const { data } = await db.from('athletes').select('academy_coach_id').eq('id', athleteId).maybeSingle();
  if (!data) return null;
  const coachIds = await coachIdsOf(db, athleteId, data.academy_coach_id ?? null);
  return raceSeat(caller, manager, athleteId, coachIds);
}
