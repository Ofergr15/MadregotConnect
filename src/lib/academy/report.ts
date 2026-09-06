import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { activityLocalDateStr, addDaysToDateStr, planWeekStartOf, resolveGroup } from '@/lib/utils';
import { ParsedWorkout } from '@/lib/ai/types';
import {
  assessWeek,
  buildPlannedWorkout,
  ActualActivity,
  AdherenceTolerances,
  PlannedWorkout,
  WeekAdherence,
  WorkoutAdherence,
} from './adherence';
import { loadAcademySettings } from './settings-server';
import { isMissingMatchesTable } from '@/lib/plans/match-athlete-activities';
import { normalizeParsedWorkouts } from '@/lib/plans/normalize-plan';
import { toLaps } from '@/lib/plan-execution/laps';
import { segmentReportFor } from '@/lib/plan-execution/resolve';
import { buildVerdict, toExecutionSummary, type ExecutionSummary } from '@/lib/plan-execution/verdict';
import type { Lap } from './segments';

/** One planned workout, plus its accuracy verdict when the caller asked for one. */
export interface WorkoutAdherenceRow extends WorkoutAdherence {
  /**
   * The same accuracy verdict the athlete sees on the run itself — `null` when it
   * could not be graded (missed session, or a paced one whose laps nobody has
   * fetched yet). Absent entirely unless `withExecution` was set, so a caller can
   * never mistake "not asked for" for "not gradeable".
   */
  execution?: ExecutionSummary | null;
}

export interface AcademyWeek extends Omit<WeekAdherence, 'workouts'> {
  workouts: WorkoutAdherenceRow[];
  /**
   * Mean accuracy (0..1) over the workouts that could be graded, null when none
   * could. Deliberately NOT averaged over all planned workouts: a week whose laps
   * haven't been read yet would report a low club accuracy that means nothing,
   * which is why `gradedCount` travels with it.
   */
  avgAccuracy?: number | null;
  /** How many of `completedCount` carried a gradeable accuracy score. */
  gradedCount?: number;
}

export interface AthleteAdherence {
  athleteId: string;
  name: string;
  week: AcademyWeek;
}

export interface AcademyWeekReport {
  weekStart: string;
  weekEnd: string;
  athletes: AthleteAdherence[];
  /**
   * The tolerances this report was graded with, from academy settings. Returned so
   * a reader can say what "on target" meant here instead of restating the defaults
   * and being wrong the moment a coach edits them in AcademySettings.
   */
  tolerances: AdherenceTolerances;
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
  /**
   * Also grade each completed workout for ACCURACY — the ring's percentage, not
   * the adherence score. Opt-in because it widens the activity read to include
   * `laps`, and raw Strava laps are stored verbatim: a club-week of them is on the
   * order of a megabyte, which the members overview has no use for.
   */
  withExecution?: boolean;
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

  if (!athletes.length) return { weekStart, weekEnd, athletes: [], tolerances };

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

  // The raw ParsedWorkout goes back alongside the PlannedWorkout it becomes.
  // `buildPlannedWorkout` reduces a session to its totals, which is all adherence
  // needs and not enough for accuracy: the per-rep verdicts are read off the
  // STEPS, so throwing the raw workout away here is what used to make a rep-level
  // score impossible anywhere but the athlete's own run page.
  const toPlanned = (workouts: ParsedWorkout[]): {
    planned: PlannedWorkout[];
    rawByDate: Map<string, ParsedWorkout>;
  } => {
    const seen = new Set<number>();
    const planned: PlannedWorkout[] = [];
    const rawByDate = new Map<string, ParsedWorkout>();
    for (const w of workouts) {
      if (seen.has(w.dayOfWeek)) continue;
      seen.add(w.dayOfWeek);
      // The same key WorkoutAdherence.date carries (it is planned.date verbatim).
      const date = addDaysStr(weekStart, w.dayOfWeek);
      planned.push(buildPlannedWorkout(w, date));
      rawByDate.set(date, w);
    }
    return { planned, rawByDate };
  };

  const plannedByAthlete = new Map<string, PlannedWorkout[]>();
  const rawByAthlete = new Map<string, Map<string, ParsedWorkout>>();
  const planIdByAthlete = new Map<string, string>();
  for (const a of athletes) {
    const own = individualPlans.find(p => p.athlete_id === a.id);
    const plan = own || sharedPlan;
    if (plan?.id) planIdByAthlete.set(a.id, plan.id);
    const { planned, rawByDate } = toPlanned(extractWorkouts(plan?.parsed_workouts, groupNumberOf(a)));
    plannedByAthlete.set(a.id, planned);
    rawByAthlete.set(a.id, rawByDate);
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

  // 3) Actual activities for the week. `laps` only when accuracy was asked for —
  // it is by far the widest column here and nothing else needs it.
  const acts = await supabase
    .from('athlete_activities')
    .select(
      'id, athlete_id, start_time, distance, duration, moving_duration, average_pace, activity_type'
      + (opts.withExecution ? ', laps' : ''),
    )
    .in('athlete_id', athleteIds)
    .gte('start_time', `${weekStart}T00:00:00Z`)
    .lte('start_time', `${weekEnd}T23:59:59Z`);

  const actualByAthlete = new Map<string, ActualActivity[]>();
  const lapsByActivity = new Map<string, Lap[]>();
  for (const r of (acts.data || []) as any[]) {
    if (opts.withExecution) lapsByActivity.set(r.id, toLaps(r.laps));
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
  const result: AthleteAdherence[] = athletes.map(a => {
    const week = assessWeek(
      plannedByAthlete.get(a.id) || [],
      actualByAthlete.get(a.id) || [],
      tolerances,
      attributionByAthlete.get(a.id),
    );
    if (!opts.withExecution) return { athleteId: a.id, name: a.name, week };
    return { athleteId: a.id, name: a.name, week: withAccuracy(week, a.id) };
  });

  /**
   * Fold the accuracy verdict into a week that has already been assessed.
   *
   * Built on the adherence row `assessWeek` just produced rather than re-deriving
   * one, so the coach's percentage and the metric rows printed beside it in the
   * compliance table describe the same run — including which activity the week
   * decided a session was run FOR, which its own attribution (or same-day
   * fallback) settled and a second pass could settle differently.
   */
  function withAccuracy(week: WeekAdherence, athleteId: string): AcademyWeek {
    const rawByDate = rawByAthlete.get(athleteId);
    const workouts: WorkoutAdherenceRow[] = week.workouts.map((w) => {
      const raw = rawByDate?.get(w.date);
      if (!w.completed || !w.actual || !raw) return { ...w, execution: null };
      // Laps are read, never fetched. Grading a club-week would otherwise mean one
      // Garmin round trip per session — and a paced session whose laps are missing
      // comes back `ungraded` rather than scored on distance alone, so the gap
      // shows up as an honest "—" instead of a confident wrong number.
      const verdict = buildVerdict({
        activityId: w.actual.id,
        athleteId,
        adherence: w,
        segments: segmentReportFor(raw, lapsByActivity.get(w.actual.id) || [], tolerances.paceSec),
        tolerances,
        workoutName: w.name,
      });
      return { ...w, execution: toExecutionSummary(verdict) };
    });

    const scores = workouts
      .map((w) => w.execution?.score)
      .filter((score): score is number => score != null);
    return {
      ...week,
      workouts,
      avgAccuracy: scores.length ? scores.reduce((sum, s) => sum + s, 0) / scores.length / 100 : null,
      gradedCount: scores.length,
    };
  }

  return { weekStart, weekEnd, athletes: result, tolerances };
}
