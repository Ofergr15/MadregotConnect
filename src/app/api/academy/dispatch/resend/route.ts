import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { requireTraineeAccess } from '@/lib/academy/pairing-server';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { pushWeekToAthlete } from '@/lib/garmin/push-week';
import { classifyDeliveryFailure, shouldTellAthlete } from '@/lib/garmin/delivery-failure';
import { notifyAthlete } from '@/lib/push';
import { watchDisconnectedCopy } from '@/lib/notifications/copy';
import type { ParsedWorkout } from '@/lib/ai/types';

export const dynamic = 'force-dynamic';
// One athlete's week: two serial Garmin calls per workout plus a read-back.
export const maxDuration = 120;

/**
 * POST /api/academy/dispatch/resend { athleteId, weekStart } — "לשלוח שוב".
 *
 * Re-pushes ONE trainee's OWN saved plan for ONE week onto their Garmin account. The
 * plans screen and the watches screen list who did not get their week; this is the
 * button beside each name.
 *
 * Scope is `requireTraineeAccess`: the academy manager, or the trainee's own dedicated
 * coach — not any staff account, which is what `push-workouts` accepts. That route takes
 * arbitrary workouts in the body; this one takes none. What is pushed is read here, from
 * the trainee's individual `weekly_plans` row for that week, so the only thing a caller
 * chooses is whose week and which week.
 *
 * Pace-zone ALERTS: the planner may veto them per push (a trainee whose paces it could not
 * resolve), and that veto is not stored on the plan. So a resend is conservative: alerts
 * only for an academy trainee, with the academy setting on, AND a goal band or a personal
 * offset to price the paces from. Without either, the written paces are somebody else's
 * and an alarm set to them is worse than none — the rule `materialiseWeek` applies.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const athleteId = typeof body?.athleteId === 'string' ? body.athleteId.trim() : '';
    const weekStart = typeof body?.weekStart === 'string' ? body.weekStart : '';
    if (!athleteId || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return NextResponse.json({ error: 'athleteId and weekStart=YYYY-MM-DD are required' }, { status: 400 });
    }

    const { denied, caller, pair } = await requireTraineeAccess(request, athleteId);
    if (denied) return denied;
    if (!pair?.isAcademy) return NextResponse.json({ error: 'not-academy' }, { status: 409 });

    const supabase = createServerClient();
    const { data: athlete, error: athleteError } = await supabase
      .from('athletes')
      .select('id, name, garmin_auth, is_academy, group_id, groups!group_id(pace_profile)')
      .eq('id', athleteId)
      .eq('coach_id', COACH_ID)
      .eq('status', 'active')
      .maybeSingle();
    if (athleteError) return NextResponse.json({ error: 'Failed to read the athlete' }, { status: 500 });
    if (!athlete) return NextResponse.json({ error: 'not-active' }, { status: 409 });
    if (!(athlete as { garmin_auth?: unknown }).garmin_auth) {
      return NextResponse.json({ error: 'garmin-not-connected' }, { status: 409 });
    }

    // Their own plan for the week, newest first — a rebuilt week inserts a new row.
    const { data: plan, error: planError } = await supabase
      .from('weekly_plans')
      .select('id, parsed_workouts, created_at')
      .eq('coach_id', COACH_ID)
      .eq('athlete_id', athleteId)
      .eq('week_start_date', weekStart)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (planError) return NextResponse.json({ error: 'Failed to read the plan' }, { status: 500 });
    const saved = (plan?.parsed_workouts as { workouts?: ParsedWorkout[] } | null)?.workouts;
    if (!plan || !Array.isArray(saved) || saved.length === 0) {
      return NextResponse.json({ error: 'no-plan' }, { status: 409 });
    }
    const plannedWorkouts = normalizeWorkoutParts({ workouts: saved }).workouts as ParsedWorkout[];

    const { paceAlerts } = await loadAcademySettings();
    const priced = pair.academyBandId !== null || pair.academyPaceOffsetSec !== null;
    const paceTarget = !!(athlete as { is_academy?: boolean }).is_academy && paceAlerts && priced;

    const result = await pushWeekToAthlete({
      supabase,
      athlete: athlete as any,
      plannedWorkouts,
      weekStartDate: weekStart,
      planId: plan.id,
      paceTarget,
      cleanDayOnce: caller.isSuperUser,
    });

    if (result.status === 'failed') {
      // The same rule as push-workouts: tell the athlete only when it is theirs to fix,
      // under the same per-week tag, so a coach pressing this four times sends it once.
      if (shouldTellAthlete(result.error)) {
        try {
          await notifyAthlete({
            athleteId,
            kind: 'watch_disconnected',
            copy: watchDisconnectedCopy,
            url: '/dashboard/profile?tab=datasource',
            tag: `watch-disconnected-${athleteId}-${weekStart}`,
            category: 'workouts',
          });
        } catch {
          // best effort
        }
      }
      return NextResponse.json(
        { error: 'push-failed', blame: classifyDeliveryFailure(result.error), detail: result.error ?? null },
        { status: 502 },
      );
    }
    return NextResponse.json({ success: true, athleteId, weekStart, workouts: plannedWorkouts.length });
  } catch (error) {
    console.error('Academy dispatch resend error:', error);
    return NextResponse.json({ error: 'Failed to resend' }, { status: 500 });
  }
}
