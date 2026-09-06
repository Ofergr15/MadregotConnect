import { NextRequest, NextResponse } from 'next/server';
import { GarminClient } from '@/lib/garmin/client';
import { convertToGarminWorkout } from '@/lib/garmin/converter';
import { createServerClient } from '@/lib/supabase/server';
import { ParsedWorkout } from '@/lib/ai/types';
import { StoredPaceProfile } from '@/lib/garmin/types';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { notifyAthlete } from '@/lib/push';
import { deliveryFailedCopy, planPushedCopy } from '@/lib/notifications/copy';
import { notifyStaff } from '@/lib/notifications/staff';
import { authError, requireSession } from '@/lib/auth-session';

interface PushResult {
  athleteId: string;
  athleteName: string;
  status: 'success' | 'failed';
  error?: string;
}

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
      try {
        if (!athlete.garmin_auth) {
          results.push({
            athleteId: athlete.id,
            athleteName: athlete.name,
            status: 'failed',
            error: 'No Garmin auth token',
          });
          continue;
        }

        const garmin = new GarminClient(athlete.garmin_auth as any);
        // StoredPaceProfile, not PaceProfile: what comes back here is the club
        // group's `{ marathonGoal, offsetSeconds }`, and calling it a zone table
        // is what used to make the converter throw on a zone-only pace step.
        const paceProfile = ((athlete as any).groups?.pace_profile || {}) as StoredPaceProfile;
        const isAcademy = !!(athlete as any).is_academy;

        // Three conditions, all required, and the request can only ever remove
        // one: the athlete is in the academy, the coach hasn't turned alerts off
        // academy-wide, and the caller didn't say the paces in this payload are
        // unresolved. `!== false` rather than a truthy test so every existing
        // caller — none of which sends the field — behaves exactly as before.
        const paceTarget = isAcademy && paceAlerts && paceAlertsAllowed !== false;

        // Ids of the workouts Garmin took, and of the rows recording them. Both
        // are collected as we go so the verification step below can prove the
        // batch landed before any of it is called a success.
        const deliveredWorkoutIds: string[] = [];
        const deliveryRowIds: string[] = [];

        for (const workout of plannedWorkouts) {
          const garminWorkout = convertToGarminWorkout(workout, paceProfile, { paceTarget });

          // Calculate the actual date for this workout
          const startDate = new Date(weekStartDate);
          startDate.setDate(startDate.getDate() + workout.dayOfWeek);
          const dateStr = startDate.toISOString().split('T')[0];

          // If this athlete already has a workout on Garmin for this exact
          // plan/day (coach edited it after the first push), delete the old
          // one from their account first — otherwise re-pushing just
          // duplicates it on the watch instead of replacing it. Best-effort:
          // a delete failure (already removed, expired auth, etc.) shouldn't
          // block sending the corrected version.
          //
          // Any row carrying a Garmin id is a candidate, not just the confirmed
          // ones: a 'pending' row means the workout WAS created on the account
          // and then something went wrong before we could confirm it, which is
          // exactly the orphan a re-push has to clean up. The empty-string guard
          // is for rows written before createWorkout started throwing —
          // `.not(... 'is', null)` doesn't exclude '', and deleting id '' asks
          // Garmin to delete a workout that was never created.
          if (planId) {
            const { data: prior } = await supabase
              .from('workout_deliveries')
              .select('id, garmin_workout_id')
              .eq('plan_id', planId)
              .eq('athlete_id', athlete.id)
              .eq('workout_date', dateStr)
              .not('garmin_workout_id', 'is', null)
              .neq('garmin_workout_id', '');
            for (const old of prior || []) {
              try {
                await garmin.deleteWorkout(old.garmin_workout_id);
              } catch {
                // best-effort — proceed to push the new one regardless
              }
            }
          }

          const workoutId = await garmin.createWorkout(garminWorkout);
          // Throws if Garmin says it scheduled a different day than we asked for.
          await garmin.scheduleWorkout(workoutId, dateStr);
          deliveredWorkoutIds.push(workoutId);

          // Recorded as 'pending', not 'success': at this point we know Garmin
          // took the workout and gave us its id, which is worth persisting
          // (it's what the cleanup above needs), but not yet that the batch is
          // on the account. The promotion below is the only thing that writes
          // 'success'.
          if (planId) {
            const delivery = {
              plan_id: planId,
              athlete_id: athlete.id,
              workout_date: dateStr,
              workout_data: garminWorkout,
              garmin_workout_id: workoutId,
              // Which published part this is, so an activity Garmin stamps with
              // `workoutId` resolves to an exact plan slot instead of being
              // re-derived from the date — ambiguous on a double day.
              workout_key: workout.workoutKey || null,
              status: 'pending',
            };
            let { data: row, error: rowError } = await supabase
              .from('workout_deliveries')
              .insert(delivery)
              .select('id')
              .single();
            if (isMissingColumn(rowError, 'workout_key')) {
              // Migration 092 not applied yet: record the delivery without it.
              // Exact attribution needs the column, but a push must not fail over
              // a column that only makes matching better.
              const { workout_key: _unmigrated, ...withoutKey } = delivery;
              ({ data: row, error: rowError } = await supabase
                .from('workout_deliveries')
                .insert(withoutKey)
                .select('id')
                .single());
            }
            if (rowError) {
              throw new Error(`Pushed to Garmin but could not record the delivery: ${rowError.message}`);
            }
            if (row?.id) deliveryRowIds.push(row.id);
          }
        }

        // The actual verification: read one of the workouts back off the
        // athlete's Garmin account. Until this passes, "delivered" would just
        // mean "the POSTs didn't throw" — which is what let an empty workout id
        // be reported as a success.
        //
        // The last of the batch rather than every one of them: a whole request
        // can already be ~2 serial Garmin calls per workout per athlete, and one
        // extra GET each is affordable where N more is not. It is also the right
        // one to pick — the failures this catches (auth expiring partway, Garmin
        // rate-limiting or 200-ing without persisting) hit the end of a batch,
        // not the start, and each individual workout id was already checked
        // against Garmin's create response.
        if (deliveredWorkoutIds.length > 0) {
          await garmin.verifyWorkoutOnAccount(deliveredWorkoutIds[deliveredWorkoutIds.length - 1]);
        }

        if (deliveryRowIds.length > 0) {
          const { error: promoteError } = await supabase
            .from('workout_deliveries')
            .update({ status: 'success' })
            .in('id', deliveryRowIds);
          // The workouts are on Garmin but the record says otherwise, so report
          // it: the rows stay 'pending', the coach sees a failure and can
          // re-push, and the cleanup above removes what this attempt created
          // rather than leaving the watch with duplicates.
          if (promoteError) {
            throw new Error(`Verified on Garmin but could not record the delivery: ${promoteError.message}`);
          }
        }

        results.push({
          athleteId: athlete.id,
          athleteName: athlete.name,
          status: 'success',
        });

        // Let the athlete know their watch has new workouts — previously
        // the only way to find out was to happen to check the app or watch;
        // pushing a plan was otherwise completely silent to them.
        //
        // Strictly after the verification above, and that ordering is the point:
        // this notification tells someone to expect training on their watch, so
        // it must not go out on a push we can't confirm Garmin actually has.
        try {
          await notifyAthlete({
            athleteId: athlete.id,
            kind: 'plan_pushed',
            copy: (locale) => planPushedCopy(locale, { count: workouts.length }),
            url: '/dashboard/program',
            tag: `plan-push-${planId || weekStartDate}`,
            category: 'program',
          });
        } catch {
          // best-effort — never let a push failure affect the actual delivery result
        }
      } catch (error: any) {
        results.push({
          athleteId: athlete.id,
          athleteName: athlete.name,
          status: 'failed',
          error: error.message || 'Unknown error',
        });

        // A summary row for the athlete's failure. Any workouts that did reach
        // Garmin before the failure keep their own 'pending' rows — they carry
        // the ids the cleanup needs, and leaving them un-promoted is what stops
        // a half-delivered week from reading as delivered.
        if (planId) {
          await supabase.from('workout_deliveries').insert({
            plan_id: planId,
            athlete_id: athlete.id,
            workout_date: weekStartDate,
            workout_data: {},
            status: 'failed',
            error_message: error.message,
          });
        }
      }
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
