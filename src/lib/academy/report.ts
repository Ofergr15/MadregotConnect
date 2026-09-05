import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { activityLocalDateStr, addDaysToDateStr, planWeekStartOf, resolveGroup } from '@/lib/utils';
import { ParsedWorkout } from '@/lib/ai/types';
import {
  assessWeek,
  buildPlannedWorkout,
  ActualActivity,
  PlannedWorkout,
  WeekAdherence,
} from './adherence';
import { loadAcademySettings } from './settings-server';
import { isMissingMatchesTable } from '@/lib/plans/match-athlete-activities';
import { normalizeParsedWorkouts } from '@/lib/plans/normalize-plan';

export interface AthleteAdherence {
  athleteId: string;
  name: string;
  week: WeekAdherence;
}

export interface AcademyWeekReport {
  weekStart: string;
  weekEnd: string;
  athletes: AthleteAdherence[];
}

// Sunday-based week start, matching how plans are saved (`planWeekStartOf`) and
// how the push route dates workouts (week_start_date + dayOfWeek, dayOfWeek 0=Sun).
//
// Thin wrappers over the shared helpers now: the no-argument form used to be
// `new Date()` plus `getUTCDay()`, which on Vercel's UTC clock resolves to the UTC
// calendar date — still yesterday between 00:00 and 03:00 in Israel. The cron that
// calls `addDaysStr(sundayOf(null), -7)` would then report the week before last.
export function sundayOf(dateStr?: string | null): string {
  return planWeekStartOf(dateStr);
}

export function addDaysStr(dateStr: string, days: number): string {
  return addDaysToDateStr(dateStr, days);
}

/**
 * A weekly_plans.parsed_workouts blob → the ParsedWorkout[] for ONE group.
 *
 * `groupNumber` matters: this used to always take the first group it found —
 * group1 — for every athlete. Distances happen to be identical across the three
 * groups in the plans published so far, but PACES are not: measured over the
 * published plans, 67% of group-2/3 work-pace bands differ from group 1's, by a
 * median of 10 s/km and up to 20 s/km. Against the ±5 s/km pace tolerance that
 * means a group-2 or group-3 athlete running exactly what their coach prescribed
 * was graded "slower than target" by construction.
 *
 * Falls back to any group present, then to any nested `workouts` array, so an
 * unusual blob still yields a plan rather than nothing.
 */
function extractWorkouts(raw: any, groupNumber = 1): ParsedWorkout[] {
  if (!raw) return [];
  // Normalized so `workoutKey` is present even on plans published before the write
  // paths normalized — without it there is nothing to join activity_plan_matches on.
  const parsed = normalizeParsedWorkouts(raw) as any;
  if (Array.isArray(parsed.workouts)) return parsed.workouts;
  const preferred = parsed[`group${groupNumber}`]?.workouts;
  if (Array.isArray(preferred)) return preferred;
  for (const key of ['group1', 'group2', 'group3']) {
    if (parsed[key]?.workouts && Array.isArray(parsed[key].workouts)) return parsed[key].workouts;
  }
  for (const val of Object.values(parsed)) {
    if (val && typeof val === 'object' && Array.isArray((val as any).workouts)) return (val as any).workouts;
  }
  return [];
}

/**
 * Compute per-academy-athlete adherence for a week. Shared by the /api/academy/
 * adherence route and the weekly-report cron. Guarded against unmigrated columns.
 */
export async function computeAcademyWeekAdherence(opts: {
  weekStart?: string | null;
  onlyAthleteId?: string | null;
}): Promise<AcademyWeekReport> {
  const weekStart = sundayOf(opts.weekStart);
  const weekEnd = addDaysStr(weekStart, 6);
  const supabase = createServerClient();
  const { tolerances } = await loadAcademySettings();

  // 1) Academy athletes (or a single requested one).
  const athRes = await supabase
    .from('athletes')
    .select('id, name, is_academy, group_id')
    .eq('coach_id', COACH_ID);

  let athletes: any[] = athRes.error ? [] : (athRes.data || []).filter((a: any) => a.is_academy);
  if (opts.onlyAthleteId) athletes = athletes.filter(a => a.id === opts.onlyAthleteId);

  if (!athletes.length) return { weekStart, weekEnd, athletes: [] };

  const athleteIds = athletes.map(a => a.id);

  // Which of the plan's three group variants each athlete is actually graded
  // against. One query for the whole table rather than per athlete — see
  // extractWorkouts for why using the wrong group misgrades pace.
  const groupsRes = await supabase.from('groups').select('id, name');
  const groupNames = new Map<string, string>(
    (groupsRes.data || []).map((g: any) => [g.id, g.name]),
  );
  const groupNumberOf = (athlete: any): number => {
    if (!athlete.group_id) return 2; // ungrouped athletes sit with the middle group
    const index = resolveGroup(groupNames.get(athlete.group_id)).index;
    return index >= 0 ? index + 1 : 2;
  };

  // 2) Planned workouts per athlete — individual plan wins, else shared group plan.
  // Ordered newest-first so `.find()` below picks the most recent plan per
  // athlete — weekly_plans has no uniqueness constraint on (athlete_id,
  // week_start_date), and a coach re-pushing a revised plan for the same
  // athlete/week always INSERTs a new row rather than updating the old one,
  // so more than one can exist for the same key.
  const indiv = await supabase
    .from('weekly_plans')
    .select('id, athlete_id, week_start_date, parsed_workouts, created_at')
    .eq('week_start_date', weekStart)
    .in('athlete_id', athleteIds)
    .order('created_at', { ascending: false });
  const individualPlans: any[] = indiv.error ? [] : indiv.data || [];

  // The shared/group plan is the coach-wide one (athlete_id IS NULL) — must NOT
  // pick up another athlete's individual plan for the same week. Fall back to the
  // unscoped query if the athlete_id column isn't migrated.
  let shared = await supabase
    .from('weekly_plans')
    .select('id, week_start_date, parsed_workouts, created_at')
    .eq('coach_id', COACH_ID)
    .eq('week_start_date', weekStart)
    .is('athlete_id', null)
    .order('created_at', { ascending: false });
  if (shared.error) {
    shared = await supabase
      .from('weekly_plans')
      .select('id, week_start_date, parsed_workouts, created_at')
      .eq('coach_id', COACH_ID)
      .eq('week_start_date', weekStart)
      .order('created_at', { ascending: false });
  }
  const sharedPlan = (shared.data || [])[0];

  const toPlanned = (workouts: ParsedWorkout[]): PlannedWorkout[] => {
    const seen = new Set<number>();
    const out: PlannedWorkout[] = [];
    for (const w of workouts) {
      if (seen.has(w.dayOfWeek)) continue;
      seen.add(w.dayOfWeek);
      out.push(buildPlannedWorkout(w, addDaysStr(weekStart, w.dayOfWeek)));
    }
    return out;
  };

  const plannedByAthlete = new Map<string, PlannedWorkout[]>();
  const planIdByAthlete = new Map<string, string>();
  for (const a of athletes) {
    const own = individualPlans.find(p => p.athlete_id === a.id);
    const plan = own || sharedPlan;
    if (plan?.id) planIdByAthlete.set(a.id, plan.id);
    plannedByAthlete.set(a.id, toPlanned(extractWorkouts(plan?.parsed_workouts, groupNumberOf(a))));
  }

  // Which activity was attributed to which workout — the SAME attribution the
  // matcher wrote and the coach can override, rather than this engine's own guess
  // by date. Absent (unmigrated table, or an athlete not yet re-synced) it simply
  // stays empty and assessWeek falls back to matching by day.
  const attributionByAthlete = new Map<string, Map<string, string[]>>();
  const planIds = Array.from(new Set(planIdByAthlete.values()));
  if (planIds.length) {
    const matchRes = await supabase
      .from('activity_plan_matches')
      .select('athlete_id, weekly_plan_id, workout_key, activity_id')
      .in('athlete_id', athleteIds)
      .in('weekly_plan_id', planIds);
    if (matchRes.error && !isMissingMatchesTable(matchRes.error)) throw matchRes.error;
    for (const row of (matchRes.data || []) as any[]) {
      // Ignore a match against a plan this athlete isn't actually graded on.
      if (planIdByAthlete.get(row.athlete_id) !== row.weekly_plan_id) continue;
      const forAthlete = attributionByAthlete.get(row.athlete_id) || new Map<string, string[]>();
      const ids = forAthlete.get(row.workout_key) || [];
      ids.push(row.activity_id);
      forAthlete.set(row.workout_key, ids);
      attributionByAthlete.set(row.athlete_id, forAthlete);
    }
  }

  // 3) Actual activities for the week.
  const acts = await supabase
    .from('athlete_activities')
    .select('id, athlete_id, start_time, distance, duration, moving_duration, average_pace, activity_type')
    .in('athlete_id', athleteIds)
    .gte('start_time', `${weekStart}T00:00:00Z`)
    .lte('start_time', `${weekEnd}T23:59:59Z`);

  const actualByAthlete = new Map<string, ActualActivity[]>();
  for (const r of (acts.data || []) as any[]) {
    const arr = actualByAthlete.get(r.athlete_id) || [];
    arr.push({
      id: r.id,
      date: activityLocalDateStr(r.start_time),
      distance: Number(r.distance) || 0,
      duration: Number(r.duration) || 0,
      movingDuration: r.moving_duration != null ? Number(r.moving_duration) : null,
      averagePace: r.average_pace != null ? Number(r.average_pace) : null,
      activityType: r.activity_type,
    });
    actualByAthlete.set(r.athlete_id, arr);
  }

  // 4) Assess each athlete.
  const result: AthleteAdherence[] = athletes.map(a => ({
    athleteId: a.id,
    name: a.name,
    week: assessWeek(
      plannedByAthlete.get(a.id) || [],
      actualByAthlete.get(a.id) || [],
      tolerances,
      attributionByAthlete.get(a.id),
    ),
  }));

  return { weekStart, weekEnd, athletes: result };
}
