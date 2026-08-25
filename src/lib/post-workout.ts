import { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';

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

/**
 * Sends (at most once per athlete per calendar day) the post-workout feedback
 * prompt for the MAIN workout of that day — longest by distance among ALL of
 * that athlete's activities on `dateStr`, queried fresh from the DB rather
 * than scoped to whichever sync call happens to be running.
 *
 * Previously each of garmin/sync-activities, strava/sync-activities, and the
 * per-call "which activity is newest" logic only ever considered the
 * activities newly inserted by THAT ONE call — syncing twice in a day (a
 * manual sync mid-run, then again after finishing; or Garmin + a later
 * Strava/manual entry) could fire the prompt twice, and/or point it at
 * whichever call happened to see the longer activity rather than the real
 * longest one across the whole day. A shared ledger row (kind
 * 'post_workout_prompt_ledger', reusing the app's #ledger: idempotency
 * convention) makes this fire exactly once regardless of how many sync calls
 * happen, always targeting the day's actual longest activity at fire time.
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
      .select('garmin_activity_id, distance, activity_type')
      .eq('athlete_id', opts.athleteId)
      .gte('start_time', `${opts.dateStr}T00:00:00`)
      .lt('start_time', `${opts.dateStr}T23:59:59.999`);
    if (!acts || acts.length === 0) return;

    const main = acts.reduce((a, b) => ((b.distance ?? 0) > (a.distance ?? 0) ? b : a));
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
