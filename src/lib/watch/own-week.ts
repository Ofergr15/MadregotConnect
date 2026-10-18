import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { getDisplayWeekStart } from '@/lib/plans/workout-parsing';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { withGroupPaces } from '@/lib/plans/watch-paces';
import { paceGroupKeyFor } from '@/lib/plans/pace-group';
import { pushWeekToAthlete } from '@/lib/garmin/push-week';
import type { ParsedWorkout } from '@/lib/ai/types';
import { appleCandidates, deliverWeek, resolveWatchProvider, type WatchProvider } from './index';

// One runner's own club week onto their own watch — what POST /api/my-watch does when they
// tap "send to watch", and what a reconnect does by itself (lib/watch/reconnect.ts). Lifted
// out of the route unchanged so both follow one set of rules.

type Db = ReturnType<typeof createServerClient>;

/** The runner's row, their group's paces, and the club plan for the week. */
export async function loadOwnWeek(athleteId: string, weekStartDate = getDisplayWeekStart(new Date())) {
  const supabase = createServerClient();
  // The row and the plan don't depend on each other: asked together, one round trip.
  const [{ data: athlete }, { data: plan }] = await Promise.all([supabase
    .from('athletes')
    .select('id, name, garmin_auth, is_academy, group_id, groups!group_id(pace_profile)')
    .eq('id', athleteId)
    .maybeSingle(),
  supabase
    .from('weekly_plans')
    .select('id, parsed_workouts, status')
    .eq('coach_id', COACH_ID)
    .eq('week_start_date', weekStartDate)
    // The club's week only. A trainee's own academy week is a weekly_plans row too
    // (athlete_id set) and would otherwise compete for limit(1).
    .is('athlete_id', null)
    // A week can hold a draft and a pushed plan; 'pushed' sorts after 'draft' and 'partial'.
    .order('status', { ascending: false })
    .limit(1)
    .maybeSingle()]);
  return { supabase, weekStartDate, athlete, plan };
}

/** Garmin when the row says so — decided without a query. Otherwise the Apple lookup. */
export async function providerFor(
  supabase: Db,
  athlete: { id: string; name?: string | null; garmin_auth?: unknown } | null,
): Promise<WatchProvider> {
  if (!athlete) return 'garmin';
  const target = { id: athlete.id, name: athlete.name || '', garmin_auth: athlete.garmin_auth };
  return resolveWatchProvider(target, await appleCandidates(supabase, [target]));
}

export type OwnWeekResult =
  | { status: 'ok'; provider: WatchProvider; weekStartDate: string }
  | { status: 'garmin-not-connected' | 'no-plan' | 'no-workouts' }
  | { status: 'failed'; error: string };

export async function pushOwnWeek(athleteId: string, weekStartDate?: string): Promise<OwnWeekResult> {
  const { supabase, weekStartDate: week, athlete, plan } = await loadOwnWeek(athleteId, weekStartDate);
  const provider = await providerFor(supabase, athlete);
  if (!athlete?.garmin_auth && provider !== 'apple') return { status: 'garmin-not-connected' };
  if (!plan?.parsed_workouts) return { status: 'no-plan' };

  // Which of the plan's three pace variants is this athlete's (lib/plans/pace-group.ts).
  const { data: groups } = await supabase.from('groups').select('id, pace_profile').eq('coach_id', COACH_ID);
  const groupKey = paceGroupKeyFor(
    (groups || []).map((g: { id: string; pace_profile: { marathonGoal?: number | null } | null }) => ({
      id: g.id, marathonGoal: g.pace_profile?.marathonGoal ?? null,
    })),
    (athlete as { group_id?: string | null }).group_id,
  );
  const parsed = plan.parsed_workouts as Record<string, { workouts?: ParsedWorkout[] }> & { workouts?: ParsedWorkout[] };
  // A flat plan (one pace for everyone) has no variants to choose between.
  const variant = parsed[groupKey]?.workouts || parsed.workouts || [];
  if (variant.length === 0) return { status: 'no-workouts' };
  // Every pack's pace on the watch, not only this runner's (lib/plans/watch-paces.ts).
  const plannedWorkouts = withGroupPaces(normalizeWorkoutParts({ workouts: variant }).workouts, plan.parsed_workouts);

  // Always the club's week, and a club week never carries pace-zone alarms, even for an
  // academy athlete: alarms are for a trainee's own week, sent from the academy screens.
  const paceTarget = false;
  const result = provider === 'apple'
    ? await deliverWeek('apple', { supabase, athlete: athlete as never, plannedWorkouts, weekStartDate: week, planId: plan.id, paceTarget, notify: false })
    : await pushWeekToAthlete({
      supabase, athlete: athlete as never, plannedWorkouts, weekStartDate: week, planId: plan.id, paceTarget,
      // A self-push or a reconnect: the runner is holding the phone that just did this.
      notify: false,
      cleanDayOnce: true,
    });
  if (result.status === 'failed') return { status: 'failed', error: result.error || 'push-failed' };
  return { status: 'ok', provider, weekStartDate: week };
}
