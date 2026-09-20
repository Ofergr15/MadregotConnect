import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { COACH_ID } from '@/lib/constants';
import { getDisplayWeekStart } from '@/lib/plans/workout-parsing';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { paceGroupKeyFor } from '@/lib/plans/pace-group';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { pushWeekToAthlete } from '@/lib/garmin/push-week';
import type { ParsedWorkout } from '@/lib/ai/types';

/**
 * "Is this week's training actually on my watch?" — and, if it isn't, the one tap
 * that puts it there.
 *
 * ── Why this exists (bc77a4a2 + c1334a75) ────────────────────────────────────
 *
 * Every piece of this was already built and none of it was visible to the person
 * it is about. `workout_deliveries` has recorded, per athlete per date, whether
 * Garmin confirmed the workout — since the delivery code learned to refuse to say
 * "success" on anything less than a read-back off the account. But that table was
 * read only by coach and admin screens. The athlete, who is the one standing at
 * the start of a session with a watch that may or may not know what to do, had no
 * way to find out except by looking at the watch.
 *
 * ⚠️ SCOPE. This is the one route in the app that lets a non-staff caller cause a
 * write to a Garmin account, so the rule is absolute: **the athlete id comes from
 * the session and from nowhere else.** There is no id in the body, no id in the
 * query string, nothing to forge. `requireAthlete` also insists on an active club
 * member, so a session with no athlete row cannot reach the Garmin client at all.
 * A caller can therefore only ever act on themselves, which is why adding this
 * does not widen the service-role surface the rest of the API already runs on.
 *
 *   GET  → what the card shows: is Garmin connected, which of this week's dates
 *          Garmin has confirmed, and whether there's a plan at all.
 *   POST → push this week onto the caller's own account, then answer with the
 *          same shape GET does, so the card can redraw from one response.
 */

export const dynamic = 'force-dynamic';
// Two serial Garmin calls per workout plus a read-back. One athlete's week is a
// fraction of what the coach's whole-group push needs, but not a fraction of 15s.
export const maxDuration = 120;

interface WatchState {
  /** No Garmin account linked — a Strava-only athlete has no watch to put this on. */
  garminConnected: boolean;
  /** The plan week the answer is about, the same one the dashboard is displaying. */
  weekStartDate: string;
  hasPlan: boolean;
  /** Dates (YYYY-MM-DD) Garmin has CONFIRMED. 'pending' is deliberately not here. */
  onWatch: string[];
}

/**
 * The truthful read. `status: 'success'` only, because that is the only value
 * written after a workout was read back off the athlete's account — a 'pending'
 * row means a push started and we never confirmed it, and telling somebody their
 * session is on their watch when it might not be is the failure this whole
 * feature exists to prevent.
 */
async function readWatchState(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  weekStartDate: string,
  hasPlan: boolean,
  garminConnected: boolean,
): Promise<WatchState> {
  const weekEnd = new Date(weekStartDate);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  const { data } = await supabase
    .from('workout_deliveries')
    .select('workout_date')
    .eq('athlete_id', athleteId)
    .eq('status', 'success')
    .gte('workout_date', weekStartDate)
    .lte('workout_date', weekEndStr);

  return {
    garminConnected,
    weekStartDate,
    hasPlan,
    onWatch: [...new Set((data || []).map((r: { workout_date: string }) => r.workout_date))].sort(),
  };
}

/** The caller's row, their group's paces, and the plan for the displayed week. */
async function loadContext(athleteId: string) {
  const supabase = createServerClient();
  const weekStartDate = getDisplayWeekStart(new Date());

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, name, garmin_auth, is_academy, group_id, groups(pace_profile)')
    .eq('id', athleteId)
    .maybeSingle();

  const { data: plan } = await supabase
    .from('weekly_plans')
    .select('id, parsed_workouts, status')
    .eq('coach_id', COACH_ID)
    .eq('week_start_date', weekStartDate)
    // A week can hold a draft and a pushed plan; the pushed one is the real one,
    // and 'pushed' sorts after 'draft' and 'partial'.
    .order('status', { ascending: false })
    .limit(1)
    .maybeSingle();

  return { supabase, weekStartDate, athlete, plan };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAthlete(request);
    if (!auth.ok) return authError(auth);

    const { supabase, weekStartDate, athlete, plan } = await loadContext(auth.user.athleteId);

    return NextResponse.json(
      await readWatchState(
        supabase,
        auth.user.athleteId,
        weekStartDate,
        !!plan,
        // Never the token itself, not even a truncation of it — the credential is
        // encrypted at rest and a boolean is the whole of what a client needs.
        !!athlete?.garmin_auth,
      ),
    );
  } catch (error) {
    console.error('my-watch read error:', error);
    return NextResponse.json({ error: 'Failed to read watch status' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAthlete(request);
    if (!auth.ok) return authError(auth);

    const { supabase, weekStartDate, athlete, plan } = await loadContext(auth.user.athleteId);

    if (!athlete?.garmin_auth) {
      return NextResponse.json({ error: 'garmin-not-connected' }, { status: 409 });
    }
    if (!plan?.parsed_workouts) {
      return NextResponse.json({ error: 'no-plan' }, { status: 409 });
    }

    // Which of the plan's three pace variants is this athlete's. One shared rule
    // with the planner — see lib/plans/pace-group.ts for why that matters here
    // more than anywhere else in the app.
    const { data: groups } = await supabase
      .from('groups')
      .select('id, pace_profile')
      .eq('coach_id', COACH_ID);
    const groupKey = paceGroupKeyFor(
      (groups || []).map((g: { id: string; pace_profile: any }) => ({
        id: g.id,
        marathonGoal: g.pace_profile?.marathonGoal ?? null,
      })),
      (athlete as { group_id?: string | null }).group_id,
    );

    const parsed = plan.parsed_workouts as Record<string, { workouts?: ParsedWorkout[] }> & {
      workouts?: ParsedWorkout[];
    };
    // A flat plan (one pace for everyone) has no variants to choose between.
    const variant = parsed[groupKey]?.workouts || parsed.workouts || [];
    if (variant.length === 0) {
      return NextResponse.json({ error: 'no-workouts' }, { status: 409 });
    }
    const plannedWorkouts = normalizeWorkoutParts({ workouts: variant }).workouts;

    // Pace-zone ALERTS are an academy affordance and a coach setting; a self-push
    // must not be a way around either. Same three conditions the coach route
    // applies, minus the per-request veto, which only the planner can know about.
    const { paceAlerts } = await loadAcademySettings();
    const paceTarget = !!(athlete as { is_academy?: boolean }).is_academy && paceAlerts;

    const result = await pushWeekToAthlete({
      supabase,
      athlete: athlete as any,
      plannedWorkouts,
      weekStartDate,
      planId: plan.id,
      paceTarget,
      // They are holding the phone that just did this and are about to see the
      // card say so. A push notification would be the app telling them something
      // they had just told it.
      notify: false,
    });

    if (result.status === 'failed') {
      return NextResponse.json({ error: result.error || 'push-failed' }, { status: 502 });
    }

    // The fresh truth, read back rather than assumed, so the card redraws from
    // what `workout_deliveries` actually says after the push.
    return NextResponse.json(
      await readWatchState(supabase, auth.user.athleteId, weekStartDate, true, true),
    );
  } catch (error: any) {
    console.error('my-watch push error:', error);
    return NextResponse.json({ error: error.message || 'Failed to push to watch' }, { status: 500 });
  }
}
