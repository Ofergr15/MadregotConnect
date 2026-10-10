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
import { normalizeStoredLaps } from '@/lib/garmin/laps';
import { effortReportFor, segmentReportFor } from '@/lib/plan-execution/resolve';
import { buildVerdict, toExecutionSummary, type ExecutionSummary, type ExecutionVerdict } from '@/lib/plan-execution/verdict';
import type { EffortReport, Lap } from './segments';
import { workPaceOf } from './work-pace';

/** One planned workout, plus its accuracy verdict when the caller asked for one. */
export interface WorkoutAdherenceRow extends WorkoutAdherence {
  /**
   * The same accuracy verdict the athlete sees on the run itself — `null` when it
   * could not be graded (missed session, or a paced one whose laps nobody has
   * fetched yet). Absent entirely unless `withExecution` was set, so a caller can
   * never mistake "not asked for" for "not gradeable".
   */
  execution?: ExecutionSummary | null;
  /**
   * The pace of the WORK in a structured session — the mean over its graded
   * interval/active reps, with the band the first of them was written at. Null on
   * a session whose reps could not be read; absent unless `withExecution` was set.
   *
   * The trainee's week row needs it because the whole-run average of an interval
   * day is a number about the jog between the reps, and `pace.comparedMin` is
   * deliberately null there (see computeGradedPaceBand) — so without this the row
   * of the session that matters most would have no pace to judge at all.
   */
  workPace?: { actual: number; min: number; max: number } | null;
  /**
   * SERVER-ONLY. What the plan-vs-actual sheet is built from: the raw planned
   * workout, the stored laps and the full verdict (per-rep paces included). Set
   * only under `keepDetail`, and a route must never serialize it — raw laps are
   * the widest thing in this module, which is why the sheet route reduces them to
   * the chart's points first.
   */
  detail?: {
    workout: ParsedWorkout;
    laps: Lap[];
    /** Null for a session that has not been run. */
    verdict: ExecutionVerdict | null;
    efforts: EffortReport | null;
  };
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
  /** Several athletes (a coach's own trainees). Applied with `onlyAthleteId` when both are set. */
  onlyAthleteIds?: string[] | null;
  /**
   * Also grade each completed workout for ACCURACY — the ring's percentage, not
   * the adherence score. Opt-in because it widens the activity read to include
   * `laps`, and raw Strava laps are stored verbatim: a club-week of them is on the
   * order of a megabyte, which the members overview has no use for.
   */
  withExecution?: boolean;
  /** Also attach `detail` (implies `withExecution`). One athlete's sheet only — see WorkoutAdherenceRow.detail. */
  keepDetail?: boolean;
}): Promise<AcademyWeekReport> {
  if (opts.keepDetail) opts = { ...opts, withExecution: true };
  const weekStart = sundayOf(opts.weekStart);
  const weekEnd = addDaysStr(weekStart, 6);
  const supabase = createServerClient();

  // Every read below is small, and the cost of this function was almost entirely
  // the number of times it waited for a round trip rather than the size of any
  // one answer: seven queries in a row, ~350ms of latency each. They go in three
  // waves now — everything that needs nothing first, then everything that needs
  // only the roster, then the one thing that needs the plans. Same queries, same
  // results, three waits instead of seven.
  const [{ tolerances }, athRes, groupsRes, sharedRes] = await Promise.all([
    loadAcademySettings(),
    // 1) Academy athletes (or a single requested one).
    supabase
      .from('athletes')
      .select('id, name, is_academy, group_id')
      .eq('coach_id', COACH_ID),
    // Which of the plan's three group variants each athlete is actually graded
    // against. One query for the whole table rather than per athlete — see
    // extractWorkouts for why using the wrong group misgrades pace.
    supabase.from('groups').select('id, name'),
    // The shared/group plan is the coach-wide one (athlete_id IS NULL) — must NOT
    // pick up another athlete's individual plan for the same week. Fall back to the
    // unscoped query if the athlete_id column isn't migrated.
    supabase
      .from('weekly_plans')
      .select('id, week_start_date, parsed_workouts, created_at')
      .eq('coach_id', COACH_ID)
      .eq('week_start_date', weekStart)
      .is('athlete_id', null)
      .order('created_at', { ascending: false })
      .then((res) => (res.error
        ? supabase
          .from('weekly_plans')
          .select('id, week_start_date, parsed_workouts, created_at')
          .eq('coach_id', COACH_ID)
          .eq('week_start_date', weekStart)
          .order('created_at', { ascending: false })
        : res)),
  ]);

  let athletes: any[] = athRes.error ? [] : (athRes.data || []).filter((a: any) => a.is_academy);
  if (opts.onlyAthleteId) athletes = athletes.filter(a => a.id === opts.onlyAthleteId);
  if (opts.onlyAthleteIds) {
    const only = new Set(opts.onlyAthleteIds);
    athletes = athletes.filter(a => only.has(a.id));
  }

  if (!athletes.length) return { weekStart, weekEnd, athletes: [], tolerances };

  const athleteIds = athletes.map(a => a.id);

  const groupNames = new Map<string, string>(
    (groupsRes.data || []).map((g: any) => [g.id, g.name]),
  );
  const groupNumberOf = (athlete: any): number => groupNumberFor(athlete.group_id, groupNames);

  // 2) Planned workouts per athlete — individual plan wins, else shared group plan.
  // Ordered newest-first so `.find()` below picks the most recent plan per
  // athlete — weekly_plans has no uniqueness constraint on (athlete_id,
  // week_start_date), and a coach re-pushing a revised plan for the same
  // athlete/week always INSERTs a new row rather than updating the old one,
  // so more than one can exist for the same key.
  // Wave two: the individual plans and the week's activities. Both need only the
  // roster, so neither has any reason to wait for the other. (`acts` is read
  // further down, where the actuals are folded in.)
  const [indiv, acts] = await Promise.all([
    supabase
      .from('weekly_plans')
      .select('id, athlete_id, week_start_date, parsed_workouts, created_at')
      .eq('week_start_date', weekStart)
      .in('athlete_id', athleteIds)
      .order('created_at', { ascending: false }),
    // 3) Actual activities for the week. `laps` only when accuracy was asked for —
    // it is by far the widest column here and nothing else needs it.
    supabase
      .from('athlete_activities')
      .select(
        'id, athlete_id, start_time, distance, duration, moving_duration, average_pace, activity_type'
        + (opts.withExecution ? ', laps, average_hr' : ''),
      )
      .in('athlete_id', athleteIds)
      .gte('start_time', `${weekStart}T00:00:00Z`)
      .lte('start_time', `${weekEnd}T23:59:59Z`),
  ]);
  const individualPlans: any[] = indiv.error ? [] : indiv.data || [];
  const sharedPlan = (sharedRes.data || [])[0];

  // The raw ParsedWorkout goes back alongside the PlannedWorkout it becomes.
  // `buildPlannedWorkout` reduces a session to its totals, which is all adherence
  // needs and not enough for accuracy: the per-rep verdicts are read off the
  // STEPS, so throwing the raw workout away here is what used to make a rep-level
  // score impossible anywhere but the athlete's own run page.
  const toPlanned = (workouts: ParsedWorkout[]) => plannedForWeek(workouts, weekStart);

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

  const actualByAthlete = new Map<string, ActualActivity[]>();
  const lapsByActivity = new Map<string, Lap[]>();
  for (const r of (acts.data || []) as any[]) {
    if (opts.withExecution) lapsByActivity.set(r.id, normalizeStoredLaps(r.laps));
    const arr = actualByAthlete.get(r.athlete_id) || [];
    arr.push({
      id: r.id,
      date: activityLocalDateStr(r.start_time),
      distance: Number(r.distance) || 0,
      duration: Number(r.duration) || 0,
      movingDuration: r.moving_duration != null ? Number(r.moving_duration) : null,
      averagePace: r.average_pace != null ? Number(r.average_pace) : null,
      ...(opts.withExecution ? { averageHr: r.average_hr != null ? Number(r.average_hr) : null } : {}),
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
      if (!w.completed || !w.actual || !raw) {
        // A session not run yet still has its steps, and the trainee's home draws
        // today's from them — so under `keepDetail` the plan travels even without a run.
        return {
          ...w,
          execution: null,
          workPace: null,
          ...(opts.keepDetail && raw ? { detail: { workout: raw, laps: [], verdict: null, efforts: null } } : {}),
        };
      }
      const laps = lapsByActivity.get(w.actual.id) || [];
      const efforts = effortReportFor(raw, laps, tolerances.paceSec);
      // Laps are read, never fetched. Grading a club-week would otherwise mean one
      // Garmin round trip per session — and a paced session whose laps are missing
      // comes back `ungraded` rather than scored on distance alone, so the gap
      // shows up as an honest "—" instead of a confident wrong number.
      const verdict = buildVerdict({
        activityId: w.actual.id,
        athleteId,
        adherence: w,
        segments: segmentReportFor(raw, laps, tolerances.paceSec),
        // The same rep search this table renders below the score. It has to be in
        // the score too, or the coach reads "partially done, 15 of 19 reps at
        // target" next to a 97%.
        efforts,
        tolerances,
        workoutName: w.name,
      });
      return {
        ...w,
        execution: toExecutionSummary(verdict),
        workPace: workPaceOf(verdict, efforts),
        ...(opts.keepDetail ? { detail: { workout: raw, laps, verdict, efforts } } : {}),
      };
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

/** Which of the plan's three group variants an athlete is graded against. See extractWorkouts. */
function groupNumberFor(groupId: string | null | undefined, groupNames: Map<string, string>): number {
  if (!groupId) return 2; // ungrouped athletes sit with the middle group
  const index = resolveGroup(groupNames.get(groupId)).index;
  return index >= 0 ? index + 1 : 2;
}

/**
 * One week's ParsedWorkout[] → the PlannedWorkout[] adherence grades, plus the raw
 * workout per date.
 *
 * The raw ParsedWorkout goes back alongside the PlannedWorkout it becomes.
 * `buildPlannedWorkout` reduces a session to its totals, which is all adherence
 * needs and not enough for accuracy: the per-rep verdicts are read off the STEPS,
 * so throwing the raw workout away here is what used to make a rep-level score
 * impossible anywhere but the athlete's own run page.
 */
function plannedForWeek(workouts: ParsedWorkout[], weekStart: string): {
  planned: PlannedWorkout[];
  rawByDate: Map<string, ParsedWorkout>;
} {
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
}

/** One plan week of one athlete, reduced to the four numbers the trainee's journey reads. */
export interface AthleteWeekHistory {
  weekStart: string;
  plannedCount: number;
  completedCount: number;
  /** Mid-point of the planned distance range over the week's workouts, metres. */
  plannedM: number;
  /** Every activity in the plan week (Sun–Sat), metres. */
  ranM: number;
}

/**
 * Many weeks of ONE athlete's adherence, for the trainee home's km chart and its
 * journey tiles ("% of plan done", "weeks in a row ≥80%").
 *
 * Not `computeAcademyWeekAdherence` in a loop: that is three waves of queries per
 * week, so a season of tiles would be ~150 round trips. This reads each table
 * ONCE for the whole range — the plans, the activities, the matcher's attribution
 * — and grades each week in memory with the same `assessWeek`, the same group
 * variant and the same individual-over-shared plan precedence, so a week here
 * counts exactly what the compliance table counts for it.
 *
 * No laps: nothing here needs accuracy, only completed-or-not.
 */
export async function computeAthleteWeekHistory(opts: {
  athleteId: string;
  /** Plan week starts (Sundays), inclusive. */
  fromWeek: string;
  toWeek: string;
}): Promise<AthleteWeekHistory[]> {
  const fromWeek = sundayOf(opts.fromWeek);
  const toWeek = sundayOf(opts.toWeek);
  if (fromWeek > toWeek) return [];
  const weeks: string[] = [];
  for (let w = fromWeek; w <= toWeek; w = addDaysStr(w, 7)) weeks.push(w);
  const lastDay = addDaysStr(toWeek, 6);

  const supabase = createServerClient();
  const [{ tolerances }, athRes, groupsRes, sharedRes, indivRes, actsRes] = await Promise.all([
    loadAcademySettings(),
    supabase.from('athletes').select('id, group_id').eq('id', opts.athleteId).maybeSingle(),
    supabase.from('groups').select('id, name'),
    supabase
      .from('weekly_plans')
      .select('id, week_start_date, parsed_workouts, created_at')
      .eq('coach_id', COACH_ID)
      .is('athlete_id', null)
      .gte('week_start_date', fromWeek)
      .lte('week_start_date', toWeek)
      .order('created_at', { ascending: false }),
    supabase
      .from('weekly_plans')
      .select('id, week_start_date, parsed_workouts, created_at')
      .eq('athlete_id', opts.athleteId)
      .gte('week_start_date', fromWeek)
      .lte('week_start_date', toWeek)
      .order('created_at', { ascending: false }),
    supabase
      .from('athlete_activities')
      .select('id, start_time, distance, duration, moving_duration, average_pace, activity_type')
      .eq('athlete_id', opts.athleteId)
      .gte('start_time', `${fromWeek}T00:00:00Z`)
      .lte('start_time', `${lastDay}T23:59:59Z`),
  ]);

  const groupNames = new Map<string, string>((groupsRes.data || []).map((g: any) => [g.id, g.name]));
  const groupNumber = groupNumberFor((athRes.data as any)?.group_id ?? null, groupNames);

  // Newest-first per week, individual over shared — the same precedence as the
  // single-week report (a re-pushed plan INSERTs a new row).
  const planOf = new Map<string, any>();
  for (const p of (sharedRes.error ? [] : sharedRes.data || []) as any[]) {
    if (!planOf.has(p.week_start_date)) planOf.set(p.week_start_date, p);
  }
  const ownWeeks = new Set<string>();
  for (const p of (indivRes.error ? [] : indivRes.data || []) as any[]) {
    if (ownWeeks.has(p.week_start_date)) continue;
    ownWeeks.add(p.week_start_date);
    planOf.set(p.week_start_date, p);
  }

  const attribution = new Map<string, Map<string, string[]>>();
  const planIds = [...new Set([...planOf.values()].map((p) => p.id).filter(Boolean))];
  if (planIds.length) {
    const matchRes = await supabase
      .from('activity_plan_matches')
      .select('weekly_plan_id, workout_key, activity_id')
      .eq('athlete_id', opts.athleteId)
      .in('weekly_plan_id', planIds);
    if (matchRes.error && !isMissingMatchesTable(matchRes.error)) throw matchRes.error;
    for (const row of (matchRes.data || []) as any[]) {
      const forPlan = attribution.get(row.weekly_plan_id) || new Map<string, string[]>();
      const ids = forPlan.get(row.workout_key) || [];
      ids.push(row.activity_id);
      forPlan.set(row.workout_key, ids);
      attribution.set(row.weekly_plan_id, forPlan);
    }
  }

  const actsByWeek = new Map<string, ActualActivity[]>();
  for (const r of (actsRes.error ? [] : actsRes.data || []) as any[]) {
    if (!r.start_time) continue;
    const date = activityLocalDateStr(r.start_time);
    const week = sundayOf(date);
    const arr = actsByWeek.get(week) || [];
    arr.push({
      id: r.id,
      date,
      distance: Number(r.distance) || 0,
      duration: Number(r.duration) || 0,
      movingDuration: r.moving_duration != null ? Number(r.moving_duration) : null,
      averagePace: r.average_pace != null ? Number(r.average_pace) : null,
      activityType: r.activity_type,
    });
    actsByWeek.set(week, arr);
  }

  return weeks.map((weekStart) => {
    const plan = planOf.get(weekStart);
    const { planned } = plannedForWeek(extractWorkouts(plan?.parsed_workouts, groupNumber), weekStart);
    const acts = actsByWeek.get(weekStart) || [];
    const week = assessWeek(planned, acts, tolerances, plan?.id ? attribution.get(plan.id) : undefined);
    return {
      weekStart,
      plannedCount: week.plannedCount,
      completedCount: week.completedCount,
      plannedM: Math.round(planned.reduce((sum, p) => sum + (p.distanceMin + p.distanceMax) / 2, 0)),
      ranM: Math.round(acts.reduce((sum, a) => sum + a.distance, 0)),
    };
  });
}
