import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { ParsedWorkout } from '@/lib/ai/types';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { deliveryFailedCopy } from '@/lib/notifications/copy';
import { notifyStaff } from '@/lib/notifications/staff';
import { authError, requireSession } from '@/lib/auth-session';
import { pushWeekToAthlete, type PushResult } from '@/lib/garmin/push-week';

// One request carries a whole pace group — every athlete in it, up to 7 workouts
// each — and each workout costs two serial Garmin calls plus a read-back per
// athlete. Twenty athletes is comfortably past the default ceiling.
export const maxDuration = 300;

// Staff-only. This writes workouts onto athletes' actual Garmin watches and
// push-notifies each of them, so an open handler let anyone spam the whole club's
// devices with arbitrary training.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireSession(req);
    if (!auth.ok) return authError(auth);
    if (!auth.user.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    // `paceAlerts` is a caller-side VETO, never a grant — see where it's applied
    // below. The academy planner sends false for a trainee whose paces it could
    // not resolve, so an unresolved pace stays information instead of becoming a
    // pace-zone alarm on their watch.
    const { planId, workouts, athleteIds, weekStartDate, paceAlerts: paceAlertsAllowed } = await req.json();

    if (!workouts || !athleteIds || !weekStartDate) {
      return NextResponse.json(
        { error: 'workouts, athleteIds, and weekStartDate are required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Fetch athletes with their auth tokens and group pace profiles. Academy
    // athletes (is_academy) get pace-zone TARGETS (alerting); everyone else gets
    // info-only pace text. The is_academy column may not exist yet on older DBs,
    // so fall back to a select without it rather than failing the whole push.
    let athletes: any[] | null = null;
    let athletesError: any = null;

    const primary = await supabase
      .from('athletes')
      .select('id, name, email, garmin_auth, is_academy, group_id, groups(pace_profile)')
      .in('id', athleteIds)
      .eq('status', 'active');

    if (primary.error) {
      const fallback = await supabase
        .from('athletes')
        .select('id, name, email, garmin_auth, group_id, groups(pace_profile)')
        .in('id', athleteIds)
        .eq('status', 'active');
      athletes = fallback.data;
      athletesError = fallback.error;
    } else {
      athletes = primary.data;
    }

    if (athletesError || !athletes) {
      return NextResponse.json(
        { error: 'Failed to fetch athletes' },
        { status: 500 }
      );
    }

    const results: PushResult[] = [];

    // Normalized here so every delivery can record which published part it was.
    // `workoutKey` is what an activity carrying a Garmin workout id resolves to
    // (migration 092), and the planner UI posts whatever it happens to hold — for
    // a plan saved before the write paths normalized, that's no key at all. The
    // keys are deterministic, so normalizing again is a no-op on anything that
    // already has them. See lib/plans/normalize-plan.ts.
    const plannedWorkouts = normalizeWorkoutParts({ workouts: workouts as ParsedWorkout[] }).workouts;

    // Academy pace-zone alerts are on by default but coach-toggleable in settings.
    const { paceAlerts } = await loadAcademySettings();

    for (const athlete of athletes) {
      // Three conditions, all required, and the request can only ever remove
      // one: the athlete is in the academy, the coach hasn't turned alerts off
      // academy-wide, and the caller didn't say the paces in this payload are
      // unresolved. `!== false` rather than a truthy test so every existing
      // caller — none of which sends the field — behaves exactly as before.
      const paceTarget = !!(athlete as any).is_academy && paceAlerts && paceAlertsAllowed !== false;
      // The delivery itself lives in lib/garmin/push-week.ts — the athlete's own
      // one-tap push (POST /api/my-watch) calls the same function, so there is one
      // set of rules about when a delivery may be called a success.
      results.push(await pushWeekToAthlete({
        supabase,
        athlete: athlete as any,
        plannedWorkouts: plannedWorkouts as ParsedWorkout[],
        weekStartDate,
        planId: planId || null,
        paceTarget,
      }));
    }

    // One alert for the whole batch, after the loop rather than inside it. A
    // Garmin outage or an expired token fails every athlete in the run, and 20
    // identical pushes say nothing the first one didn't — so this counts the
    // failures and sends once, naming the total so "3 of 20" and "20 of 20"
    // read as the different problems they are.
    //
    // Push only, no inbox row: this repeats every time a coach retries, and a
    // durable row per attempt would bury the inbox in the same sentence. The
    // per-athlete detail is already on the screen the coach is looking at.
    const failed = results.filter((r) => r.status === 'failed').length;
    if (failed > 0) {
      await notifyStaff({
        kind: 'workout_delivery_failed',
        url: '/dashboard/program',
        // Per-week, so a retry replaces the previous alert instead of stacking.
        tag: `delivery-failed-${weekStartDate}`,
        category: 'management',
        pushOnly: true,
        copy: (locale) => deliveryFailedCopy(locale, { failed, total: results.length }),
      });
    }

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error('Push workouts error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to push workouts' },
      { status: 500 }
    );
  }
}
