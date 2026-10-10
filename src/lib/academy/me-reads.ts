// The reads behind the trainee's own academy screens, shared by GET /api/academy/me (the
// v1 home) and GET /api/academy/today (the v2 home), so the two can never name a
// different coach, count a different unread badge or read the race from a different row.
// Server-only. Every helper is scoped to the ONE athlete whose screen this is.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getStreamServerClient } from '@/lib/stream/server';
import { readCharacterization, type Characterization } from './characterization';
import { traineeUnreadCount } from './thread-server';
import { coachIdsOf } from './trainee-coaches';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export interface CoachRow {
  id: string;
  name: string;
  avatar_url: string | null;
}

/** All their coaches (a shared trainee has several), legacy first. */
export async function loadCoachRows(supabase: Db, athleteId: string, legacyCoachId: string | null): Promise<{ data: CoachRow[]; error: null }> {
  const ids = await coachIdsOf(supabase, athleteId, legacyCoachId);
  if (!ids.length) return { data: [], error: null };
  const { data, error } = await supabase.from('athletes').select('id, name, avatar_url').in('id', ids);
  const rows = (error ? [] : (data || [])) as CoachRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { data: ids.map((id) => byId.get(id)).filter((r): r is CoachRow => !!r), error: null };
}

/**
 * The characterization call's answers, through the candidate row that became this
 * athlete. Only the three goal fields — never the coach's verdict or the limitations
 * note, which the goal card has no use for.
 */
export async function loadGoalCharacterization(supabase: Db, athleteId: string): Promise<Characterization | null> {
  const { data: cands, error } = await supabase
    .from('academy_candidates')
    .select('id')
    .eq('athlete_id', athleteId);
  if (error || !cands?.length) return null;
  const { data: rows, error: cErr } = await supabase
    .from('academy_characterizations')
    .select('candidate_id, goal_type, target_race, target_race_date')
    .in('candidate_id', cands.map((c: { id: string }) => c.id));
  if (cErr || !rows?.length) return null;
  // More than one candidate row for a person is a re-application; the one with a race
  // named is the one that says what they are training for now.
  const read = rows.map((r) => readCharacterization(r as Record<string, unknown>));
  return read.find((c) => c.targetRace) ?? read.find((c) => c.goalType) ?? null;
}

/** The red dot. Never throws and never waits more than 1.5 s. */
export async function loadTraineeUnread(athleteId: string): Promise<number> {
  try { return await traineeUnreadCount(getStreamServerClient(), athleteId); } catch { return 0; }
}
