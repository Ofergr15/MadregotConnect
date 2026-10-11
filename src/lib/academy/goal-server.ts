// The goal's reads and the one write (lib/academy/goal.ts is the shape). Server-only.
//
// Migration 144 (`academy_goals`) ships after this code, so every read feature-detects it: a
// missing table reads as "no stored goal" and falls back to the characterization, exactly what
// the trainee's home read before 144 existed. A write without the table answers `tableMissing`
// and the route says which migration.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { readCharacterization } from './characterization';
import { goalFromCharacterization, hasGoal, readGoal, type Goal } from './goal';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const GOALS_TABLE = 'academy_goals';
const COLUMNS = 'athlete_id, goal_type, target_race, target_race_date, goal_time_sec';

export interface GoalRead {
  goal: Goal;
  /** Where it came from: migration 144's row, the characterization call, or nowhere. */
  source: 'goals' | 'characterization' | 'none';
  /** False before migration 144: a save cannot be stored yet. */
  stored: boolean;
}

/** The characterization goals of these athletes, through their candidate rows. */
async function characterizationGoals(db: Db, athleteIds: string[]): Promise<Map<string, Goal>> {
  const out = new Map<string, Goal>();
  if (!athleteIds.length) return out;
  try {
    const { data: cands, error } = await db.from('academy_candidates').select('id, athlete_id').in('athlete_id', athleteIds);
    if (error || !cands?.length) return out;
    const byCandidate = new Map((cands as Array<{ id: string; athlete_id: string }>).map(c => [c.id, c.athlete_id]));
    const { data: rows, error: cErr } = await db
      .from('academy_characterizations')
      .select('candidate_id, goal_type, target_race, target_race_date')
      .in('candidate_id', [...byCandidate.keys()]);
    if (cErr || !rows) return out;
    for (const row of rows as Array<Record<string, unknown>>) {
      const athleteId = byCandidate.get(String(row.candidate_id));
      if (!athleteId) continue;
      const goal = goalFromCharacterization(readCharacterization(row));
      // A re-application: the one that names a race says what they train for now.
      const prev = out.get(athleteId);
      if (!prev || (!prev.targetRace && goal.targetRace) || (!hasGoal(prev) && hasGoal(goal))) out.set(athleteId, goal);
    }
  } catch { /* a goal is optional: no answer, never a failed screen */ }
  return out;
}

/** Every given athlete's goal, migration 144 first. */
export async function loadGoals(db: Db, athleteIds: string[]): Promise<{ goals: Map<string, GoalRead>; stored: boolean }> {
  const goals = new Map<string, GoalRead>();
  if (!athleteIds.length) return { goals, stored: true };
  let stored = true;
  const own = new Map<string, Goal>();
  try {
    const { data, error } = await db.from(GOALS_TABLE).select(COLUMNS).in('athlete_id', athleteIds);
    if (error) stored = !isMissingTable(error);
    for (const row of (error ? [] : data || []) as Array<Record<string, unknown>>) {
      own.set(String(row.athlete_id), readGoal(row));
    }
  } catch { /* read as none */ }
  const fallback = await characterizationGoals(db, athleteIds.filter(id => !hasGoal(own.get(id))));
  for (const id of athleteIds) {
    const mine = own.get(id);
    if (mine && hasGoal(mine)) goals.set(id, { goal: mine, source: 'goals', stored });
    else if (fallback.has(id) && hasGoal(fallback.get(id))) goals.set(id, { goal: fallback.get(id)!, source: 'characterization', stored });
    else goals.set(id, { goal: mine ?? goalFromCharacterization(null), source: 'none', stored });
  }
  return { goals, stored };
}

export async function loadGoal(db: Db, athleteId: string): Promise<GoalRead> {
  const { goals } = await loadGoals(db, [athleteId]);
  return goals.get(athleteId)!;
}

/** Upsert one trainee's goal. `tableMissing` before migration 144. */
export async function saveGoal(
  db: Db,
  athleteId: string,
  goal: Goal,
  by: string | null,
): Promise<{ ok: true } | { ok: false; tableMissing: boolean }> {
  const { error } = await db.from(GOALS_TABLE).upsert({
    athlete_id: athleteId,
    goal_type: goal.goalType,
    target_race: goal.targetRace,
    target_race_date: goal.targetRaceDate,
    goal_time_sec: goal.goalTimeSec,
    updated_by: by,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'athlete_id' });
  if (!error) return { ok: true };
  if (!isMissingTable(error)) console.error('academy_goals upsert failed:', error);
  return { ok: false, tableMissing: isMissingTable(error) };
}
