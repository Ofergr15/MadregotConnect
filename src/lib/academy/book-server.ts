/**
 * The reads the workout book v3 routes share: thresholds, the club's week, a trainee's
 * week, the roster of trainees a coach can send to. Server-only.
 *
 * Every read here degrades rather than throws, in the same way the academy routes all do:
 * the tables are migrated by hand, and a screen that loads with a missing piece named is
 * better than one that does not load.
 */

import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { resolveGroup } from '@/lib/utils';
import type { ParsedWorkout } from '@/lib/ai/types';
import { thresholdPaceSec } from './tests';
import { laneReferences } from './senior-pick';
import type { Lane } from './group-lane';

type Supabase = ReturnType<typeof createServerClient>;

/**
 * Each trainee's threshold, sec/km, from their newest approved 30-minute test.
 *
 * The 30-minute protocol only, the composer's rule: a 2000 m effort is faster than
 * threshold, and a trainee's paces must not depend on which test they happened to run last.
 */
export async function loadThresholds(supabase: Supabase, athleteIds: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = Object.fromEntries(athleteIds.map(id => [id, null]));
  if (!athleteIds.length) return out;
  // Migration 108's `status` first, then the shape before it. Typed loosely because the two
  // selects differ by exactly that column.
  const read = (columns: string) => supabase
    .from('academy_tests')
    .select(columns)
    .in('athlete_id', athleteIds)
    .eq('protocol', '30min')
    .order('test_date', { ascending: false });
  let { data, error }: { data: any[] | null; error: unknown } = await read('athlete_id, test_date, duration_sec, distance_m, excluded_reason, status');
  if (error && isMissingColumn(error)) {
    ({ data, error } = await read('athlete_id, test_date, duration_sec, distance_m, excluded_reason'));
  }
  if (error || !data) return out;
  for (const row of data as any[]) {
    if (out[row.athlete_id] != null) continue;
    if (row.excluded_reason) continue;
    if ((row.status ?? 'approved') !== 'approved') continue;
    const pace = thresholdPaceSec({ durationSec: row.duration_sec, distanceM: row.distance_m });
    if (pace && pace > 0) out[row.athlete_id] = Math.round(pace);
  }
  return out;
}

/** The three lanes' reference thresholds, from the club's squad names. */
export async function loadLaneReferences(supabase: Supabase): Promise<Record<Lane, number>> {
  const { data } = await supabase.from('groups').select('name').eq('coach_id', COACH_ID);
  const groups = (data || []).map((g: any) => {
    const index = resolveGroup(g.name).index;
    return { name: g.name as string | null, lane: index >= 0 ? ((index + 1) as Lane) : null };
  });
  return laneReferences(groups);
}

/** The club's plan for a Sunday week — the senior groups' — or null. */
export async function loadClubWeek(supabase: Supabase, weekStart: string): Promise<unknown | null> {
  const { data, error } = await supabase
    .from('weekly_plans')
    .select('parsed_workouts, created_at')
    .eq('coach_id', COACH_ID)
    .eq('week_start_date', weekStart)
    .is('athlete_id', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0]?.parsed_workouts ?? null;
}

export interface TraineeWeek {
  planId: string | null;
  workouts: ParsedWorkout[];
}

/** One trainee's own plan for a week (the newest row, which is the one adherence reads). */
export async function loadTraineeWeeks(
  supabase: Supabase,
  athleteIds: string[],
  weekStart: string,
): Promise<Record<string, TraineeWeek>> {
  const out: Record<string, TraineeWeek> = Object.fromEntries(athleteIds.map(id => [id, { planId: null, workouts: [] }]));
  if (!athleteIds.length) return out;
  const { data, error } = await supabase
    .from('weekly_plans')
    .select('id, athlete_id, parsed_workouts, created_at')
    .eq('coach_id', COACH_ID)
    .eq('week_start_date', weekStart)
    .in('athlete_id', athleteIds)
    .order('created_at', { ascending: false });
  if (error || !data) return out;
  for (const row of data as any[]) {
    const current = out[row.athlete_id];
    if (!current || current.planId) continue;
    const workouts = (row.parsed_workouts as { workouts?: ParsedWorkout[] } | null)?.workouts;
    out[row.athlete_id] = { planId: String(row.id), workouts: Array.isArray(workouts) ? workouts : [] };
  }
  return out;
}

export interface RosterTrainee {
  id: string;
  name: string;
  isAcademy: boolean;
  active: boolean;
  bandNumber: number | null;
  hasGarmin: boolean;
}

/** Name, band and watch for a set of trainees. */
export async function loadTrainees(supabase: Supabase, athleteIds: string[]): Promise<RosterTrainee[]> {
  if (!athleteIds.length) return [];
  const { data, error } = await supabase
    .from('athletes')
    .select('id, name, is_academy, status, academy_band_id, garmin_auth')
    .in('id', athleteIds);
  if (error || !data) return [];
  const bandIds = [...new Set((data as any[]).map(a => a.academy_band_id).filter(Boolean))];
  const bands: Record<string, number> = {};
  if (bandIds.length) {
    const { data: rows } = await supabase.from('academy_bands').select('id, band_number').in('id', bandIds);
    for (const b of (rows || []) as any[]) bands[b.id] = b.band_number;
  }
  return (data as any[]).map(a => ({
    id: String(a.id),
    name: String(a.name || ''),
    isAcademy: !!a.is_academy,
    active: (a.status ?? 'active') === 'active',
    bandNumber: a.academy_band_id ? bands[a.academy_band_id] ?? null : null,
    hasGarmin: !!a.garmin_auth,
  }));
}

/** Every active academy trainee — the manager's roster. */
export async function allAcademyTraineeIds(supabase: Supabase): Promise<string[]> {
  const { data, error } = await supabase
    .from('athletes')
    .select('id, is_academy, status')
    .eq('coach_id', COACH_ID)
    .eq('is_academy', true);
  if (error || !data) return [];
  return (data as any[]).filter(a => (a.status ?? 'active') === 'active').map(a => String(a.id));
}
