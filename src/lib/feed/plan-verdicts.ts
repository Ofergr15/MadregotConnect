import type { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { activityLocalDateStr, planWeekStartOf, resolveGroup } from '@/lib/utils';
import { assessWorkout, buildPlannedWorkout, type MetricStatus, type PaceStatus } from '@/lib/academy/adherence';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { laneWorkouts, type Lane } from '@/lib/academy/group-lane';
import { PLAN_STATUSES } from '@/lib/plans/plan-status';
import { verdictLevel, type PlanVerdictLevel } from '@/lib/academy/verdict';
import { PR_RUN_TYPES } from '@/lib/prs/pr-buckets';

type SupabaseServer = ReturnType<typeof createServerClient>;

/**
 * "Did this run match the plan?" as a badge on a feed card.
 *
 * The whole-run answer only. The per-rep effort check needs per-step laps, which
 * are cached for a few hundred rows all-time and otherwise have to be fetched
 * from Garmin one activity at a time — impossible in a list request, and the
 * reason the badge stops at the run's totals. Tapping the card runs the full
 * check (`?verdict=1` on the segments route) and shows the reps.
 *
 * Grading is not re-implemented here: the same `assessWorkout` the academy
 * compliance table uses, on the same lane resolution, so a coach cannot get two
 * different verdicts for one run out of two screens. What IS new is doing it for
 * a page of runs in a fixed number of queries instead of one round trip per run.
 */
export interface FeedPlanVerdict {
  level: PlanVerdictLevel;
  workoutName: string;
  distanceStatus: MetricStatus;
  paceStatus: PaceStatus;
}

/** What the loader needs off each activity row on the page. */
export interface VerdictActivityRow {
  id: string;
  athlete_id: string;
  activity_type?: string | null;
  start_time: string;
  distance?: number | null;
  duration?: number | null;
  moving_duration?: number | null;
  average_pace?: number | null;
}

/**
 * Each athlete's pace lane, for a whole page at once.
 *
 * `groupNumberForAthlete` answers this for one athlete in two round trips; on a
 * 20-card feed page that's 40. Same resolution — `resolveGroup` on the group
 * name, defaulting to lane 2 — in two queries total.
 */
async function lanesForAthletes(
  supabase: SupabaseServer,
  athleteIds: string[],
): Promise<Map<string, Lane>> {
  const out = new Map<string, Lane>();
  if (athleteIds.length === 0) return out;
  const { data: athletes } = await supabase
    .from('athletes').select('id, group_id').in('id', athleteIds);
  const groupIds = [...new Set((athletes || []).map(a => a.group_id).filter(Boolean))];
  const { data: groups } = groupIds.length
    ? await supabase.from('groups').select('id, name').in('id', groupIds)
    : { data: [] as { id: string; name: string | null }[] };
  const nameById = new Map((groups || []).map(g => [g.id, g.name]));
  for (const athlete of athletes || []) {
    const index = resolveGroup(athlete.group_id ? nameById.get(athlete.group_id) : null).index;
    out.set(athlete.id, (index >= 0 ? index + 1 : 2) as Lane);
  }
  return out;
}

/**
 * Grade a page of feed activities against their days' plans.
 *
 * Best-effort by construction: the feed is the app's landing page and a missing
 * plan, an unmigrated column or a bad row must cost it nothing. Anything that
 * goes wrong leaves that activity out of the map, and a card with no entry simply
 * shows no badge.
 */
export async function loadFeedPlanVerdicts(
  supabase: SupabaseServer,
  rows: VerdictActivityRow[],
): Promise<Map<string, FeedPlanVerdict>> {
  const out = new Map<string, FeedPlanVerdict>();
  // A running plan grades runs; a ride on a plan day isn't a failed workout.
  const runs = rows.filter(r => !r.activity_type || PR_RUN_TYPES.includes(r.activity_type));
  if (runs.length === 0) return out;

  try {
    const athleteIds = [...new Set(runs.map(r => r.athlete_id))];
    const weeks = [...new Set(runs.map(r => planWeekStartOf(activityLocalDateStr(r.start_time))))];

    // Lanes, individual plans, shared plans and the tolerance settings are four
    // independent reads — the feed's critical path, so they go out together.
    // Published weeks only (PLAN_STATUSES): a draft is the coach mid-edit, and a
    // red "off plan" chip for a week nobody was asked to run is worse than no chip.
    const [lanes, indivRes, sharedRes, settings] = await Promise.all([
      lanesForAthletes(supabase, athleteIds),
      supabase
        .from('weekly_plans').select('week_start_date, athlete_id, parsed_workouts, created_at')
        .in('week_start_date', weeks).in('athlete_id', athleteIds)
        .in('status', PLAN_STATUSES)
        .order('created_at', { ascending: false }),
      supabase
        .from('weekly_plans').select('week_start_date, parsed_workouts, created_at')
        .eq('coach_id', COACH_ID).in('week_start_date', weeks).is('athlete_id', null)
        .in('status', PLAN_STATUSES)
        .order('created_at', { ascending: false }),
      loadAcademySettings(),
    ]);
    const { tolerances } = settings;

    // Newest-first from the queries, so the FIRST row seen for a key wins and
    // duplicate plans for one week resolve the same way the segments route does.
    const indivByKey = new Map<string, unknown>();
    for (const p of indivRes.data || []) {
      const key = `${p.athlete_id}|${p.week_start_date}`;
      if (!indivByKey.has(key)) indivByKey.set(key, p.parsed_workouts);
    }
    const sharedByWeek = new Map<string, unknown>();
    for (const p of sharedRes.data || []) {
      if (!sharedByWeek.has(p.week_start_date)) sharedByWeek.set(p.week_start_date, p.parsed_workouts);
    }
    if (indivByKey.size === 0 && sharedByWeek.size === 0) return out;

    // laneWorkouts runs splitIntoGroups, which is not free, so cache per
    // (plan, lane) rather than per activity — a club page is one plan and three
    // lanes, not twenty plans.
    const laneCache = new Map<string, ReturnType<typeof laneWorkouts>>();
    const workoutsFor = (parsed: unknown, cacheKey: string, lane: Lane) => {
      const key = `${cacheKey}|${lane}`;
      let cached = laneCache.get(key);
      if (!cached) {
        cached = laneWorkouts(parsed, lane);
        laneCache.set(key, cached);
      }
      return cached;
    };

    for (const row of runs) {
      const date = activityLocalDateStr(row.start_time);
      const weekStart = planWeekStartOf(date);
      const lane = lanes.get(row.athlete_id) ?? 2;
      // The athlete's own plan wins over the club-wide one, as everywhere else.
      const indiv = indivByKey.get(`${row.athlete_id}|${weekStart}`);
      const parsed = indiv ?? sharedByWeek.get(weekStart);
      if (!parsed) continue;
      const cacheKey = indiv ? `i:${row.athlete_id}:${weekStart}` : `s:${weekStart}`;
      const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
      const planned = workoutsFor(parsed, cacheKey, lane).find(w => w.dayOfWeek === dayOfWeek);
      if (!planned) continue;

      const graded = assessWorkout(
        buildPlannedWorkout(planned, date),
        {
          id: row.id,
          date,
          distance: Number(row.distance) || 0,
          duration: Number(row.duration) || 0,
          movingDuration: row.moving_duration != null ? Number(row.moving_duration) : null,
          averagePace: row.average_pace != null ? Number(row.average_pace) : null,
          activityType: row.activity_type ?? undefined,
        },
        tolerances,
      );
      const level = verdictLevel({
        workoutName: planned.name,
        date,
        activityId: row.id,
        distance: graded.distance,
        duration: graded.duration,
        pace: graded.pace,
        score: graded.score,
        // No laps in a list request — the badge is the whole-run answer, and
        // passing no effort report is what makes verdictLevel say so.
        efforts: null,
      });
      // Nothing was gradeable: a badge reading "nothing to compare" is noise on a
      // card. The plan is still visible on the run's detail.
      if (level === 'unknown') continue;
      out.set(row.id, {
        level,
        workoutName: planned.name,
        distanceStatus: graded.distance.status,
        paceStatus: graded.pace.status,
      });
    }
  } catch (err) {
    console.error('Feed plan verdicts failed (badge omitted):', err);
  }
  return out;
}
