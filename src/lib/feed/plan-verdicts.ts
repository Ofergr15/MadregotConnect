import type { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { activityLocalDateStr, planWeekStartOf, resolveGroup } from '@/lib/utils';
import { assessWorkout, buildPlannedWorkout, type MetricStatus, type PaceStatus } from '@/lib/academy/adherence';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { laneWorkouts, type Lane } from '@/lib/academy/group-lane';
import { buildVerdict, toExecutionSummary, type ExecutionSummary } from '@/lib/plan-execution/verdict';
import { segmentReportFor } from '@/lib/plan-execution/resolve';
import { toLaps } from '@/lib/plan-execution/laps';
import { PR_RUN_TYPES } from '@/lib/prs/pr-buckets';

type SupabaseServer = ReturnType<typeof createServerClient>;

/**
 * The accuracy ring on a feed card — "did this run match the plan?".
 *
 * Stored laps only — never a Garmin call, because a list request cannot make one
 * per row. That is the single difference from what tapping the card computes
 * (`?verdict=1` on the segments route), which will fetch and cache the reps for a
 * run nobody has opened yet and can therefore grade a session this loader leaves
 * ungraded. The scores never disagree; the card sometimes has an answer where the
 * feed has none, and never the reverse.
 *
 * Grading is not re-implemented here: `assessWorkout` on the same lane
 * resolution and `segmentReportFor` on the same laps, handed to the same
 * `buildVerdict` the detail card and the coach's compliance table use, so one run
 * cannot come out as two different scores on two screens. What IS new is doing it
 * for a page of runs in a fixed number of queries instead of one round trip per
 * run — which is what let the client-side fetch behind every card go away.
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

    // Lanes, individual plans, shared plans, tolerances and the cached laps are
    // five independent reads — the feed's critical path, so they go out together.
    //
    // The laps are what keep an interval session gradeable here. Without them a
    // structured workout's entire content — its per-rep paces — is unreadable, so
    // `buildVerdict` correctly refuses to score it and the card loses its ring;
    // quality sessions are a large share of a training week, so that would have
    // been a visible downgrade dressed up as caution. They are affordable because
    // of the viewer filter above: this reads laps for the handful of runs on the
    // page that belong to the person looking, not for all twenty. Nothing from
    // them reaches the client — only the four-field summary crosses the wire.
    const [lanes, indivRes, sharedRes, settings, lapsRes] = await Promise.all([
      lanesForAthletes(supabase, athleteIds),
      supabase
        .from('weekly_plans').select('week_start_date, athlete_id, parsed_workouts, created_at')
        .in('week_start_date', weeks).in('athlete_id', athleteIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('weekly_plans').select('week_start_date, parsed_workouts, created_at')
        .eq('coach_id', COACH_ID).in('week_start_date', weeks).is('athlete_id', null)
        .order('created_at', { ascending: false }),
      loadAcademySettings(),
      supabase
        .from('athlete_activities').select('id, laps').in('id', runs.map(r => r.id)),
    ]);
    const { tolerances } = settings;
    // `laps` arrived with migration 024 and is written by the sync and by any
    // earlier open of the run. An unmigrated column errors the query rather than
    // the request, and every session then grades as whole-run only — the same
    // answer this loader gave before the column existed.
    const lapsById = new Map<string, unknown>(
      (lapsRes.data || []).map((r: { id: string; laps?: unknown }) => [r.id, r.laps]));

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
      const verdict = buildVerdict({
        activityId: row.id,
        athleteId: row.athlete_id,
        adherence: graded,
        // The same `segmentReportFor` the detail card and the coach's table call,
        // on the same laps, so one run cannot come out as two different
        // percentages on two screens. `null` when nothing is stored — and on a
        // session whose whole content was per-rep paces that is what makes
        // `buildVerdict` answer `ungraded` rather than score the one metric left,
        // distance, which anyone who finished the session covered.
        segments: segmentReportFor(planned, toLaps(lapsById.get(row.id)), tolerances.paceSec),
        tolerances,
        workoutName: planned.name,
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
