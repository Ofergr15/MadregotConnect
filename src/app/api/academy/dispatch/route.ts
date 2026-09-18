import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { israelToday } from '@/lib/utils';
import { connectionState, PROVIDER_HEALTH_COLUMNS_101 } from '@/lib/providers/health';
import {
  buildDispatchReport,
  slotKey,
  type DeliveryRow,
  type DispatchAthlete,
} from '@/lib/academy/dispatch';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/dispatch?weekStart=YYYY-MM-DD — "did the week reach the watches?"
 *
 * STAFF ONLY, and scoped exactly as `/api/academy/threads/inbox` is: a manager sees
 * every pair because that is the job, a coach sees only their own trainees.
 * Enforced here rather than in the component, because this payload names every
 * trainee and their connection health — a coach filtering client-side would still
 * have been handed the whole academy.
 *
 * The verdicts are NOT computed here. `buildDispatchReport` is pure and tested,
 * and it is where the one distinction that matters lives: an athlete whose
 * activities are not reaching us is reported `blind`, never `no_run`. This route
 * assembles the three inputs that decision needs and hands them over.
 */

function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** Sun→Sat, matching every other week in this app. */
const weekEnd = (weekStart: string) => addDays(weekStart, 6);

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const isManager = caller.isSuperUser || caller.role === 'admin';

    const url = new URL(request.url);
    const weekStart = url.searchParams.get('weekStart') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return NextResponse.json({ error: 'weekStart=YYYY-MM-DD is required' }, { status: 400 });
    }
    const end = weekEnd(weekStart);

    const supabase = createServerClient();

    // Migration 101 is still unapplied, and its two timestamps are the whole basis
    // of `blind`. Without them every athlete reads `unknown`, which
    // `connectionState` treats as healthy on purpose — so the screen degrades to
    // "we can see everyone", which is what this app claimed before 101 existed
    // rather than a fresh deploy accusing the academy of broken watches. Reported
    // as `healthUnknown` so the UI can say which of the two it is showing.
    const ROSTER = 'id, name, is_academy, academy_coach_id, garmin_auth';
    let healthUnknown = false;
    // Typed loosely, exactly as `push-workouts` does for the same reason: the
    // fallback select is a different shape, and narrowing it is not worth naming
    // two row types for a payload every field of which is checked below.
    let rosterRows: any[] | null = null;
    const withHealth = await supabase
      .from('athletes')
      .select(`${ROSTER}, ${PROVIDER_HEALTH_COLUMNS_101}`)
      .eq('coach_id', COACH_ID);
    if (withHealth.error) {
      healthUnknown = true;
      const fallback = await supabase.from('athletes').select(ROSTER).eq('coach_id', COACH_ID);
      if (fallback.error) {
        return NextResponse.json({ error: 'Failed to read the roster' }, { status: 500 });
      }
      rosterRows = fallback.data;
    } else {
      rosterRows = withHealth.data;
    }

    const athletes: DispatchAthlete[] = (rosterRows || [])
      .filter((a: any) => a.is_academy)
      .filter((a: any) => isManager || (a.academy_coach_id && a.academy_coach_id === caller.athleteId))
      .map((a: any) => ({
        id: a.id,
        name: a.name || a.id,
        // Garmin only. Strava never carries a workout id, so a Strava-only athlete
        // can never confirm a dispatch — which `connectionState` reports as `none`,
        // and `buildDispatchReport` then keeps out of the "skipped it" bucket.
        connection: connectionState({
          hasAuth: !!a.garmin_auth,
          lastSyncAt: a.garmin_last_sync_at,
          authFailedAt: a.garmin_auth_failed_at,
        }),
      }));

    if (athletes.length === 0) {
      // A real pre-launch empty state, not an error: as of this build exactly one
      // athlete is `is_academy`, so a coach with no trainees assigned sees nothing.
      return NextResponse.json({
        weekStart,
        rows: [],
        summary: { onAccount: 0, ranFromIt: 0, unconfirmed: 0, blind: 0 },
        needsAttention: [],
        scope: isManager ? 'academy' : 'coach',
        ...(healthUnknown ? { healthUnknown: true } : {}),
      });
    }

    const ids = athletes.map(a => a.id);

    // `device_confirmed_at` arrives with migration 092 (applied), but the same
    // graceful-degradation rule as everywhere else: without it nothing can be
    // `ran_from_it`, which is a weaker screen and not a broken one.
    const DELIVERY = 'athlete_id, workout_date, status, error_message, garmin_workout_id, created_at';
    const week = (columns: string) => supabase
      .from('workout_deliveries')
      .select(columns)
      .in('athlete_id', ids)
      .gte('workout_date', weekStart)
      .lte('workout_date', end);

    let deliveryRows: any[] | null = null;
    const confirmed = await week(`${DELIVERY}, device_confirmed_at`);
    if (isMissingColumn(confirmed.error, 'device_confirmed_at')) {
      const withoutConfirmation = await week(DELIVERY);
      if (withoutConfirmation.error) {
        return NextResponse.json({ error: 'Failed to read the deliveries' }, { status: 500 });
      }
      deliveryRows = withoutConfirmation.data as any[];
    } else if (confirmed.error) {
      return NextResponse.json({ error: 'Failed to read the deliveries' }, { status: 500 });
    } else {
      deliveryRows = confirmed.data as any[];
    }

    // Which days a run was recorded at all — the ONLY thing separating "ran it
    // freestyle" from "did not run". Read a day wide on each side because
    // `start_time` is the athlete's own wall clock stored in a TIMESTAMPTZ (see
    // lib/utils.ts), so a 06:00 Sunday run and the Sunday boundary do not line up
    // in UTC; the day key itself comes from the timestamp's own first ten
    // characters, exactly as `garmin/workout-id-backfill.ts` reads it.
    const { data: activityRows, error: activityError } = await supabase
      .from('athlete_activities')
      .select('athlete_id, start_time')
      .in('athlete_id', ids)
      .gte('start_time', `${weekStart}T00:00:00`)
      .lt('start_time', `${addDays(end, 1)}T00:00:00`);
    if (activityError) {
      return NextResponse.json({ error: 'Failed to read the activities' }, { status: 500 });
    }
    const activityDays = new Set(
      (activityRows || []).map((a: any) => slotKey(a.athlete_id, String(a.start_time || '').slice(0, 10))),
    );

    const report = buildDispatchReport({
      athletes,
      deliveries: (deliveryRows || []) as DeliveryRow[],
      activityDays,
      today: israelToday(),
    });

    return NextResponse.json({
      weekStart,
      ...report,
      scope: isManager ? 'academy' : 'coach',
      ...(healthUnknown ? { healthUnknown: true } : {}),
    });
  } catch (err: unknown) {
    console.error('GET /api/academy/dispatch error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
