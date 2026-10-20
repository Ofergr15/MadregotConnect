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
import { planPaceBasis, type PlanBasis } from './plan-basis';
import { extractWorkouts } from './report';
import { restateSteps } from './load';
import { bandThresholdSec } from './day-send';
import { PRICING_PROTOCOLS, pricingRows, type PricingSource } from './coach-baseline';

type Supabase = ReturnType<typeof createServerClient>;

/**
 * Each trainee's threshold, sec/km, and where it came from: their newest approved 30-minute
 * test, else the coach's baseline (coach-baseline.ts `pricingRows` — the shared precedence).
 *
 * The 30-minute protocol only among tests, the composer's rule: a 2000 m effort is faster
 * than threshold, and a trainee's paces must not depend on which test they happened to run last.
 */
export async function loadThresholdSources(supabase: Supabase, athleteIds: string[]): Promise<Record<string, { sec: number; source: PricingSource } | null>> {
  const out: Record<string, { sec: number; source: PricingSource } | null> = Object.fromEntries(athleteIds.map(id => [id, null]));
  if (!athleteIds.length) return out;
  // Migration 108's `status` first, then the shape before it. Typed loosely because the two
  // selects differ by exactly that column.
  const read = (columns: string) => supabase
    .from('academy_tests')
    .select(columns)
    .in('athlete_id', athleteIds)
    .in('protocol', [...PRICING_PROTOCOLS])
    .order('test_date', { ascending: false });
  let { data, error }: { data: any[] | null; error: unknown } = await read('athlete_id, test_date, protocol, duration_sec, distance_m, excluded_reason, status');
  if (error && isMissingColumn(error)) {
    ({ data, error } = await read('athlete_id, test_date, protocol, duration_sec, distance_m, excluded_reason'));
  }
  if (error || !data) return out;
  for (const row of pricingRows(data as any[])) {
    if (out[row.athlete_id] != null) continue;
    const pace = thresholdPaceSec({ durationSec: row.duration_sec, distanceM: row.distance_m });
    if (pace && pace > 0) out[row.athlete_id] = { sec: Math.round(pace), source: row.source };
  }
  return out;
}

/** Each trainee's threshold, sec/km (the numbers of `loadThresholdSources`). */
export async function loadThresholds(supabase: Supabase, athleteIds: string[]): Promise<Record<string, number | null>> {
  const src = await loadThresholdSources(supabase, athleteIds);
  return Object.fromEntries(Object.entries(src).map(([id, v]) => [id, v?.sec ?? null]));
}

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

/**
 * Whose paces a trainee's week is in, for a route that has the graded rows but not the
 * plan row (lib/academy/plan-basis.ts): their own plan → as stored; else the club's week at
 * their lane's reference, restated to `thresholdSec`.
 */
export async function loadPlanBasis(
  supabase: Supabase,
  athleteId: string,
  weekStart: string,
  thresholdSec: number | null,
): Promise<PlanBasis> {
  const weeks = await loadTraineeWeeks(supabase, [athleteId], weekStart);
  if (weeks[athleteId]?.planId) {
    return planPaceBasis({ planAthleteId: athleteId, parsedWorkouts: null, groupName: null, laneRefs: null, thresholdSec });
  }
  const [club, refs, group] = await Promise.all([
    loadClubWeek(supabase, weekStart),
    loadLaneReferences(supabase),
    supabase.from('athletes').select('groups!group_id(name)').eq('id', athleteId).maybeSingle(),
  ]);
  return planPaceBasis({
    planAthleteId: null,
    parsedWorkouts: club,
    groupName: (group.data as { groups?: { name?: string } } | null)?.groups?.name ?? null,
    laneRefs: refs,
    thresholdSec,
  });
}

/**
 * The senior (club) week a trainee with no plan of their own is following, restated to
 * THEIR threshold — the seed of their personal row when a coach plans one day of such a
 * week (launch report BL7 / N6). Without it the new row held only the day just sent, and
 * the other sessions of the week silently disappeared from the trainee (6 sessions /
 * 62.8 km became 1 / 10.2 km). Empty when there is no club week. Same lane and factor as
 * the board draws it by (loadPlanBasis / planPaceBasis).
 */
export async function loadSeniorSeed(
  supabase: Supabase,
  athleteId: string,
  weekStart: string,
  thresholdSec: number | null,
): Promise<ParsedWorkout[]> {
  const [club, refs, group] = await Promise.all([
    loadClubWeek(supabase, weekStart),
    loadLaneReferences(supabase),
    supabase.from('athletes').select('groups!group_id(name)').eq('id', athleteId).maybeSingle(),
  ]);
  if (!club) return [];
  const groupName = (group.data as { groups?: { name?: string } } | null)?.groups?.name ?? null;
  return seniorSeedWorkouts(club, groupName, refs, thresholdSec);
}

/** The pure half of loadSeniorSeed. */
export function seniorSeedWorkouts(
  club: unknown,
  groupName: string | null,
  refs: Record<Lane, number> | null,
  thresholdSec: number | null,
): ParsedWorkout[] {
  const basis = planPaceBasis({ planAthleteId: null, parsedWorkouts: club, groupName, laneRefs: refs, thresholdSec });
  const lane = resolveGroup(groupName).index + 1;
  return extractWorkouts(club, lane >= 1 ? lane : 1)
    .filter((w) => w && typeof w.dayOfWeek === 'number')
    .map((w) => ({ ...w, steps: restateSteps(w.steps, basis.scale) }));
}

export interface RosterTrainee {
  id: string;
  name: string;
  isAcademy: boolean;
  active: boolean;
  bandNumber: number | null;
  /** The band's own threshold pace (sec/km) — the no-test fallback (day-send.ts); null = none. */
  bandThresholdSec: number | null;
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
  const bandPace: Record<string, number | null> = {};
  if (bandIds.length) {
    const { data: rows } = await supabase.from('academy_bands').select('id, band_number, pace_profile').in('id', bandIds);
    for (const b of (rows || []) as any[]) {
      bands[b.id] = b.band_number;
      bandPace[b.id] = bandThresholdSec(b.pace_profile);
    }
  }
  return (data as any[]).map(a => ({
    id: String(a.id),
    name: String(a.name || ''),
    isAcademy: !!a.is_academy,
    active: (a.status ?? 'active') === 'active',
    bandNumber: a.academy_band_id ? bands[a.academy_band_id] ?? null : null,
    bandThresholdSec: a.academy_band_id ? bandPace[a.academy_band_id] ?? null : null,
    hasGarmin: !!a.garmin_auth,
  }));
}

/** Every active academy trainee — the manager's roster. */
export async function allAcademyTraineeIds(supabase: Supabase): Promise<string[]> {
  let res: any = await supabase
    .from('athletes')
    .select('id, is_academy, status, approved')
    .eq('coach_id', COACH_ID)
    .eq('is_academy', true);
  if (res.error && isMissingColumn(res.error)) {
    res = await supabase.from('athletes').select('id, is_academy, status').eq('coach_id', COACH_ID).eq('is_academy', true);
  }
  const { data, error } = res;
  if (error || !data) return [];
  // An applicant still waiting for the manager (approved=false) is not a trainee (launch N12).
  return (data as any[]).filter(a => (a.status ?? 'active') === 'active' && a.approved !== false).map(a => String(a.id));
}
