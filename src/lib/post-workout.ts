import { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';
import { getPlanWeekStart } from '@/lib/utils';
import { buildWeekBreakdown } from '@/lib/plans/workout-parsing';
import { COACH_ID } from '@/lib/constants';

// Mirrors garmin/sync-activities' and strava/sync-activities' own copies.
const RUN_TYPE_LABELS: Record<string, string> = {
  running: 'ריצה',
  trail_running: 'ריצת שטח',
  treadmill_running: 'ריצת הליכון',
  track_running: 'ריצת מסלול',
  virtual_run: 'ריצה וירטואלית',
  street_running: 'ריצת רחוב',
  indoor_running: 'ריצה באולם',
};

// Activities recorded within this many ms of each other are treated as one
// session (e.g. a watch auto-splitting a long run around a pause, or a
// separate short warmup/cooldown recording right before/after the main set) —
// generous enough to bridge a real gap without merging an unrelated later run.
const CLUSTER_GAP_MS = 90 * 60 * 1000;

interface Act { garmin_activity_id: number; distance: number; activity_type: string | null; start_time: string; duration: number | null }

/** The club's planned distance/type for one specific date, or null (rest day / no plan loaded). */
async function planTargetForDate(dateStr: string): Promise<{ min: number; max: number; type: string } | null> {
  const supabase = createServerClient();
  const weekStart = getPlanWeekStart(new Date(`${dateStr}T12:00:00`));
  const { data: plan } = await supabase
    .from('weekly_plans')
    .select('parsed_workouts')
    .eq('coach_id', COACH_ID)
    .eq('week_start_date', weekStart)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!plan?.parsed_workouts) return null;

  const dow = new Date(`${dateStr}T12:00:00`).getDay();
  const day = buildWeekBreakdown(plan.parsed_workouts).dailyDistances.find(d => d.dayOfWeek === dow);
  if (!day || day.max <= 0) return null;
  return { min: day.min, max: day.max, type: day.type };
}

/**
 * Groups same-day activities by start-time proximity (see CLUSTER_GAP_MS),
 * treating a run recorded as several separate Garmin entries close together
 * as one training session — needed because "which single activity is
 * longest" doesn't know a warmup/main-set/cooldown split even happened.
 */
function clusterByTime(acts: Act[]): Act[][] {
  const sorted = [...acts].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const clusters: Act[][] = [];
  for (const a of sorted) {
    const last = clusters[clusters.length - 1];
    const lastActivity = last?.[last.length - 1];
    const lastEnd = lastActivity ? new Date(lastActivity.start_time).getTime() + (lastActivity.duration || 0) * 1000 : null;
    if (last && lastEnd != null && new Date(a.start_time).getTime() - lastEnd <= CLUSTER_GAP_MS) {
      last.push(a);
    } else {
      clusters.push([a]);
    }
  }
  return clusters;
}

/** The activity to link the feedback prompt to — longest-by-distance among ALL
 *  of a day's activities when there's no plan to validate against (rest day,
 *  no plan pushed yet); otherwise the longest activity within whichever
 *  time-clustered session's total distance best matches what was actually
 *  planned for that day, so an unrelated longer run later the same day can't
 *  outrank the real (but shorter, or split across recordings) planned session. */
async function pickMainActivity(acts: Act[], dateStr: string): Promise<Act> {
  if (acts.length === 1) return acts[0];

  const target = await planTargetForDate(dateStr);
  if (!target) {
    return acts.reduce((a, b) => ((b.distance ?? 0) > (a.distance ?? 0) ? b : a));
  }

  const targetMid = (target.min + target.max) / 2;
  const clusters = clusterByTime(acts);
  let bestCluster = clusters[0];
  let bestDiff = Infinity;
  for (const cluster of clusters) {
    const sumKm = cluster.reduce((sum, a) => sum + (a.distance || 0), 0) / 1000;
    const diff = Math.abs(sumKm - targetMid);
    if (diff < bestDiff) { bestDiff = diff; bestCluster = cluster; }
  }
  return bestCluster.reduce((a, b) => ((b.distance ?? 0) > (a.distance ?? 0) ? b : a));
}

/**
 * Sends (at most once per athlete per calendar day) the post-workout feedback
 * prompt for the day's MAIN workout, queried fresh from the DB rather than
 * scoped to whichever sync call happens to be running.
 *
 * Previously each of garmin/sync-activities, strava/sync-activities, and the
 * per-call "which activity is newest" logic only ever considered the
 * activities newly inserted by THAT ONE call — syncing twice in a day (a
 * manual sync mid-run, then again after finishing; or Garmin + a later
 * Strava/manual entry) could fire the prompt twice, and/or point it at
 * whichever call happened to see the longer activity. A shared ledger row
 * (kind 'post_workout_prompt_ledger', reusing the app's #ledger: idempotency
 * convention) makes this fire exactly once regardless of how many sync calls
 * happen.
 *
 * Picking WHICH activity is "main" also isn't just "longest wins" anymore —
 * see pickMainActivity: it cross-checks the club's plan for that date (type +
 * distance target) and groups same-day activities by how close together in
 * time they were recorded, so a quality session split across several Garmin
 * recordings (or one unrelated longer run later the same day) doesn't throw
 * off which one actually matches what was planned.
 *
 * `dateStr` should be the LOCAL date-part of the activity that triggered this
 * check (start_time is already stored as the provider's own local wall-clock
 * — see CLAUDE.md — so no timezone conversion is needed here).
 */
export async function notifyMainWorkoutFeedback(opts: { athleteId: string; dateStr: string }): Promise<void> {
  try {
    const supabase = createServerClient();
    const tag = `postWorkoutPrompt:${opts.athleteId}:${opts.dateStr}`;

    const { count } = await supabase
      .from('scheduled_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'post_workout_prompt_ledger')
      .eq('url', `#ledger:${tag}`);
    if ((count || 0) > 0) return; // already prompted for this athlete+day

    const { data: acts } = await supabase
      .from('athlete_activities')
      .select('garmin_activity_id, distance, activity_type, start_time, duration')
      .eq('athlete_id', opts.athleteId)
      .gte('start_time', `${opts.dateStr}T00:00:00`)
      .lt('start_time', `${opts.dateStr}T23:59:59.999`);
    if (!acts || acts.length === 0) return;

    const main = await pickMainActivity(acts as Act[], opts.dateStr);
    const km = main.distance > 0 ? Math.round((main.distance / 1000) * 10) / 10 : null;
    const label = RUN_TYPE_LABELS[main.activity_type as string] || 'ריצה';
    const body = km
      ? `${label} של ${km} ק״מ — איך היה? ספרו לנו במשוב קצר`
      : 'איך היה? ספרו לנו במשוב קצר';

    await notifyAthlete({
      athleteId: opts.athleteId,
      kind: 'post_workout_prompt',
      title: 'כל הכבוד על האימון! 🏃',
      body,
      url: `/dashboard/feedback?activity=${main.garmin_activity_id}`,
      tag: `post-workout-${main.garmin_activity_id}`,
      category: 'workouts',
    });

    await supabase.from('scheduled_notifications').insert({
      kind: 'post_workout_prompt_ledger',
      title_he: 'ledger', body_he: tag,
      audience_type: 'athlete', audience_id: opts.athleteId,
      schedule_type: 'now', status: 'sent',
      last_sent_at: new Date().toISOString(), sent_count: 1,
      url: `#ledger:${tag}`,
    });
  } catch { /* best-effort — never break the sync call that triggered this */ }
}
