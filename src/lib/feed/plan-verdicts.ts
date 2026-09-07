import type { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { activityLocalDateStr, planWeekStartOf, resolveGroup } from '@/lib/utils';
import { assessWorkout, buildPlannedWorkout, type MetricStatus, type PaceStatus } from '@/lib/academy/adherence';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { laneWorkouts, type Lane } from '@/lib/academy/group-lane';
import {
  buildVerdict,
  toExecutionSummary,
  type ExecutionPaceScope,
  type ExecutionSummary,
} from '@/lib/plan-execution/verdict';
import { segmentReportFor } from '@/lib/plan-execution/resolve';
import { PLAN_STATUSES } from '@/lib/plans/plan-status';
import { PR_RUN_TYPES } from '@/lib/prs/pr-buckets';
import { flattenPlannedSteps } from '@/lib/academy/segments';
import { dominantBlock, gradePlanBlocks, traceFromLaps } from '@/lib/academy/execution';
import { dominantWatchStep, gradeWatchSteps } from '@/lib/academy/watch-steps';
import { normalizeStoredLaps } from '@/lib/garmin/laps';
import type { ExecutedWorkout } from '@/lib/garmin/executed-workout';

type SupabaseServer = ReturnType<typeof createServerClient>;

/**
 * The accuracy ring on a feed card — "did this run match the plan?".
 *
 * Distance and duration come from the run's totals, which is what those questions
 * are about. Pace does NOT: a plan of "2 km easy, 20 km at 4:25, 8 strides" is three
 * paces and the run's average is none of them, so pace is graded per block over the
 * stretch of the run each block was written about (`gradePlanBlocks`). The laps ride
 * along on the select the feed already does, so this stays a fixed number of queries.
 *
 * When the run was driven by a structured workout, that stretch is not searched for at
 * all — `gradeWatchSteps` reads the step the watch says each lap was. One extra query
 * per page fetches those step lists, and it is worth it because the search's answer is
 * an estimate in exactly the cases the club cares most about: a timed block's length
 * has to be guessed through its target pace (measured: 4:36 estimated vs 4:42 actual on
 * a 120-minute block), and an athlete running a workout of their own making gets graded
 * against a plan they never followed.
 *
 * Stored laps only — never a Garmin call, because a list request cannot make one
 * per row. That is the single difference from what tapping the card computes
 * (`?verdict=1` on the segments route), which will fetch and cache the reps for a
 * run nobody has opened yet and can therefore grade a session this loader leaves
 * ungraded. The scores never disagree; the card sometimes has an answer where the
 * feed has none, and never the reverse.
 *
 * Grading is not re-implemented here: `assessWorkout` on the same lane
 * resolution, the same block/watch-step pace resolution the segments route does,
 * and `segmentReportFor` on the same laps — all handed to the same `buildVerdict`
 * the detail card and the coach's compliance table use, so one run cannot come out
 * as two different scores on two screens. What IS new is doing it for a page of
 * runs in a fixed number of queries instead of one round trip per run — which is
 * what let the client-side fetch behind every card go away.
 *
 * Note what this does NOT emit: a score for a structured session whose reps
 * nobody could read. `buildVerdict` returns `ungraded` there, and the badge is
 * dropped. The predecessor of this loader reduced the same inputs to a word and
 * fell back to the whole-run metrics, which put a green "on plan" on any interval
 * session where the athlete covered the distance at entirely the wrong pace —
 * the one output this feature must never produce, on the app's landing page.
 */
export type FeedPlanVerdict = ExecutionSummary;

/** Who is looking — the ring is theirs, or they are staff. See `visibleRuns`. */
export interface VerdictViewer {
  athleteId: string | null;
  isStaff: boolean;
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
  /** The watch's lap markers, as stored. Unnarrowed on purpose — `traceFromLaps`
   *  reads only distance and duration, and a row that predates lap storage simply
   *  has none, which drops pace back to the whole-run answer. */
  laps?: unknown;
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
 * The step list for each watch-driven run on the page, keyed by activity id.
 *
 * Its own query rather than a column on `FEED_SELECT`: that select's callers throw on
 * error, so one unapplied migration there takes the club's landing page down. Here a
 * missing column returns an empty map and every run falls back to the distance search —
 * which is what the feed shipped yesterday, so nothing regresses.
 */
async function executedWorkoutsFor(
  supabase: SupabaseServer,
  activityIds: string[],
): Promise<Map<string, ExecutedWorkout>> {
  const out = new Map<string, ExecutedWorkout>();
  if (activityIds.length === 0) return out;
  const { data, error } = await supabase
    .from('athlete_activities')
    .select('id, executed_workout')
    .in('id', activityIds)
    .not('executed_workout', 'is', null);
  if (error) return out;
  for (const row of data || []) {
    const workout = row.executed_workout as ExecutedWorkout | null;
    if (workout?.steps?.length) out.set(row.id, workout);
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
  viewer: VerdictViewer,
): Promise<Map<string, FeedPlanVerdict>> {
  const out = new Map<string, FeedPlanVerdict>();
  // A running plan grades runs; a ride on a plan day isn't a failed workout.
  // And a score is the athlete's own: staff grade the club because that is the
  // job, everyone else gets a ring on their own runs only. Filtering here rather
  // than at render time is both the enforcement point and the cheap path — a
  // member's 20-card club page usually contains two of their own runs, so this
  // grades two rows instead of twenty.
  const runs = rows.filter(r =>
    (!r.activity_type || PR_RUN_TYPES.includes(r.activity_type))
    && (viewer.isStaff || (!!viewer.athleteId && r.athlete_id === viewer.athleteId)));
  if (runs.length === 0) return out;

  try {
    const athleteIds = [...new Set(runs.map(r => r.athlete_id))];
    const weeks = [...new Set(runs.map(r => planWeekStartOf(activityLocalDateStr(r.start_time))))];

    // Lanes, individual plans, shared plans, the tolerance settings and the watch's
    // step lists are five independent reads — the feed's critical path, so they go
    // out together. Published weeks only (PLAN_STATUSES): a draft is the coach
    // mid-edit, and a red "off plan" chip for a week nobody was asked to run is
    // worse than no chip.
    //
    // The laps need no read of their own — they ride along on `FEED_SELECT`. They are
    // what keeps an interval session gradeable here: without them a structured
    // workout's entire content, its per-rep paces, is unreadable, so `buildVerdict`
    // correctly refuses to score it and the card loses its ring. Nothing off them
    // reaches the client; only the five-field summary crosses the wire.
    const [lanes, indivRes, sharedRes, settings, executed] = await Promise.all([
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
      executedWorkoutsFor(supabase, runs.map(r => r.id)),
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

      // Block-aligned pace where the laps allow it. The dominant (longest) graded
      // block is the one the session was mostly about, and its verdict replaces the
      // whole-run average's — which on a warm-up-plus-block session reads 8 s/km
      // slow no matter how well the block was run.
      //
      // The watch's own account of which step each lap was comes first when it exists,
      // because it is evidence where the block search is inference. Both funnel through
      // the same "one dominant step" rule, so a run cannot pick up two verdicts.
      const laps = normalizeStoredLaps(row.laps);
      const workout = executed.get(row.id);
      const watched = workout
        ? gradeWatchSteps(workout, laps, lane, tolerances.paceSec)
        : null;
      const watchStep = watched ? dominantWatchStep(watched) : null;
      const trace = watchStep ? null : traceFromLaps(laps);
      const blocks = trace ? gradePlanBlocks(flattenPlannedSteps(planned), trace, tolerances.paceSec) : null;
      const block = watchStep ? null : blocks ? dominantBlock(blocks) : null;
      const dominant = watchStep ?? block;
      // The same substitution the segments route makes, for the same two reasons:
      // the row is about that block, and `comparedMin`/`comparedMax` are what let
      // `buildVerdict` score a structured session at all.
      const pace = dominant
        ? {
          ...graded.pace,
          status: dominant.status,
          plannedMin: dominant.plannedPaceMin,
          plannedMax: dominant.plannedPaceMax,
          comparedMin: dominant.plannedPaceMin,
          comparedMax: dominant.plannedPaceMax,
          actual: dominant.actualPace,
        }
        : graded.pace;
      const paceScope: ExecutionPaceScope | null = watchStep
        ? {
          label: watchStep.label,
          fromM: null,
          toM: null,
          plannedLengthM: watchStep.plannedDistanceM,
          truncated: watchStep.truncated,
          resolutionM: null,
          source: 'watch',
        }
        : block && blocks
          ? {
            label: block.label,
            fromM: block.window?.startM ?? null,
            toM: block.window?.endM ?? null,
            plannedLengthM: block.plannedLengthM,
            truncated: block.truncated,
            resolutionM: blocks.resolutionM,
            source: blocks.source,
          }
          : null;

      const verdict = buildVerdict({
        activityId: row.id,
        athleteId: row.athlete_id,
        adherence: { ...graded, pace },
        // The same `segmentReportFor` the detail card and the coach's table call,
        // on the same laps, so one run cannot come out as two different
        // percentages on two screens. `null` when nothing is stored — and on a
        // session whose whole content was per-rep paces, with no block or watch
        // step to grade either, that is what makes `buildVerdict` answer
        // `ungraded` rather than score the one metric left, distance, which
        // anyone who finished the session covered.
        segments: segmentReportFor(planned, laps, tolerances.paceSec),
        tolerances,
        workoutName: planned.name,
        paceScope,
        wholeRunPace: graded.pace.actual,
      });
      // Only a real score earns a place on the card. `ungraded` (reps unread) and
      // `unplanned` (no workout that day) are both honest answers, but a ring
      // reading "—" on a scrolling feed is noise; the run's own detail explains
      // which it was and why.
      if (verdict.status !== 'graded') continue;
      out.set(row.id, toExecutionSummary(verdict));
    }
  } catch (err) {
    console.error('Feed plan verdicts failed (badge omitted):', err);
  }
  return out;
}
