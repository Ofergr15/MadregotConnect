// The goal's reads and the one write (lib/academy/goal.ts is the shape). Server-only.
//
// Migration 144 (`academy_goals`) ships after this code, so every read feature-detects it: a
// missing table reads as "no stored goal" and falls back to the characterization, exactly what
// the trainee's home read before 144 existed. A write without the table answers `tableMissing`
// and the route says which migration.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { thresholdPaceSec } from './tests';
import { readCharacterization } from './characterization';
import { goalFromCharacterization, hasGoal, readGoal, type Goal } from './goal';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const GOALS_TABLE = 'academy_goals';
const COLUMNS_144 = 'athlete_id, goal_type, target_race, target_race_date, goal_time_sec';
/** Migration 148's race fields on top. Read first; the 144 set is the fallback until it is pasted. */
const COLUMNS = `${COLUMNS_144}, event_id, distance_km, location, date_is_estimate, result_sec`;

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

/**
 * A goal that IS a club race takes the race's day from the calendar, not from its own copy:
 * when the club moves a race, every trainee aiming at it moves with it. A race deleted from the
 * calendar leaves the goal on its own copy — never a goal that silently disappears.
 */
async function followClubRaces(db: Db, goals: Map<string, Goal>): Promise<void> {
  const ids = [...new Set([...goals.values()].map(g => g.eventId).filter((x): x is string => !!x))];
  if (!ids.length) return;
  try {
    const { data, error } = await db.from('events').select('id, name, date').in('id', ids);
    if (error || !data) return;
    const byId = new Map((data as Array<{ id: string; name: string | null; date: string | null }>).map(e => [e.id, e]));
    for (const [athleteId, g] of goals) {
      const e = g.eventId ? byId.get(g.eventId) : null;
      if (!e?.date) continue;
      goals.set(athleteId, { ...g, targetRaceDate: String(e.date).slice(0, 10), targetRace: g.targetRace || e.name || null, dateIsEstimate: false });
    }
  } catch { /* the goal's own copy stands */ }
}

/** Every given athlete's goal, migration 144 first. */
export async function loadGoals(db: Db, athleteIds: string[]): Promise<{ goals: Map<string, GoalRead>; stored: boolean }> {
  const goals = new Map<string, GoalRead>();
  if (!athleteIds.length) return { goals, stored: true };
  let stored = true;
  const own = new Map<string, Goal>();
  try {
    let { data, error }: { data: unknown[] | null; error: unknown } = await db.from(GOALS_TABLE).select(COLUMNS).in('athlete_id', athleteIds);
    if (error && isMissingColumn(error)) ({ data, error } = await db.from(GOALS_TABLE).select(COLUMNS_144).in('athlete_id', athleteIds));
    if (error) stored = !isMissingTable(error);
    for (const row of (error ? [] : data || []) as Array<Record<string, unknown>>) {
      own.set(String(row.athlete_id), readGoal(row));
    }
  } catch { /* read as none */ }
  await followClubRaces(db, own);
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
  const base = {
    athlete_id: athleteId,
    goal_type: goal.goalType,
    target_race: goal.targetRace,
    target_race_date: goal.targetRaceDate,
    goal_time_sec: goal.goalTimeSec,
    updated_by: by,
    updated_at: new Date().toISOString(),
  };
  // Migration 148's fields. A new goal clears the old result: the result belongs to the race
  // that was run, and a goal for the next one starts without it.
  const race = {
    event_id: goal.eventId ?? null,
    distance_km: goal.distanceKm ?? null,
    location: goal.location ?? null,
    date_is_estimate: !!goal.dateIsEstimate,
    result_sec: goal.resultSec ?? null,
  };
  let { error } = await db.from(GOALS_TABLE).upsert({ ...base, ...race }, { onConflict: 'athlete_id' });
  // Before 148: save what the table can hold. The race's name and day are still kept; only
  // its distance, place and estimate flag wait for the paste.
  if (error && isMissingColumn(error)) ({ error } = await db.from(GOALS_TABLE).upsert(base, { onConflict: 'athlete_id' }));
  if (!error) return { ok: true };
  if (!isMissingTable(error)) console.error('academy_goals upsert failed:', error);
  return { ok: false, tableMissing: isMissingTable(error) };
}

export interface ClubRace {
  eventId: string;
  name: string;
  /** `YYYY-MM-DD`. */
  date: string;
  location: string | null;
  /** The distances the race offers, km, longest first. */
  distancesKm: number[];
}

/** "42.2km" / "21.1 ק״מ" / 10 → km. The calendar stores distances as free strings. */
export function parseEventDistance(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > 400) return null;
  // A marathon is quoted as 42.2 and run as 42.195; keep the exact distance so the time
  // estimate and the kind agree with what the trainee will actually run.
  if (Math.abs(n - 42.2) < 0.05) return 42.195;
  if (Math.abs(n - 21.1) < 0.05) return 21.0975;
  return n;
}

/** The club's upcoming races from the calendar (`events`, kind 'race'), soonest first. */
export async function loadClubRaces(db: Db, today: string): Promise<ClubRace[]> {
  try {
    const { data, error } = await db
      .from('events')
      .select('id, name, date, location, distances, kind')
      .eq('kind', 'race')
      .gte('date', today)
      .order('date', { ascending: true })
      .limit(12);
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((e) => {
      const list = Array.isArray(e.distances) ? e.distances : [];
      const distancesKm = [...new Set(list.map(parseEventDistance).filter((n): n is number => n != null))].sort((a, b) => b - a);
      return {
        eventId: String(e.id),
        name: String(e.name ?? '').trim(),
        date: String(e.date ?? '').slice(0, 10),
        location: typeof e.location === 'string' && e.location.trim() ? e.location.trim() : null,
        distancesKm,
      };
    }).filter((r) => r.name && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  } catch {
    return [];
  }
}

/** The threshold pace (sec/km) of the trainee's latest approved 30-minute test, or null. */
export async function loadThresholdPace(db: Db, athleteId: string): Promise<number | null> {
  try {
    const { data, error } = await db
      .from('academy_tests')
      .select('test_date, protocol, status, excluded_reason, duration_sec, distance_m')
      .eq('athlete_id', athleteId)
      .order('test_date', { ascending: false })
      .limit(20);
    if (error || !data) return null;
    for (const r of data as Array<Record<string, unknown>>) {
      if (r.excluded_reason) continue;
      if ((r.protocol ?? '30min') !== '30min') continue;
      if ((r.status ?? 'approved') !== 'approved') continue;
      const pace = thresholdPaceSec({ durationSec: Number(r.duration_sec), distanceM: Number(r.distance_m) });
      if (pace && pace > 0) return pace;
    }
    return null;
  } catch {
    return null;
  }
}

