import { GarminClient } from '@/lib/garmin/client';
import { convertToGarminWorkout } from '@/lib/garmin/converter';
import { createServerClient } from '@/lib/supabase/server';
import { ParsedWorkout } from '@/lib/ai/types';
import { StoredPaceProfile } from '@/lib/garmin/types';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { notifyAthlete } from '@/lib/push';
import { planPushedCopy } from '@/lib/notifications/copy';

/**
 * Putting one athlete's week onto their Garmin account.
 *
 * Lifted out of `POST /api/garmin/push-workouts` unchanged, because there is now
 * a second caller: an athlete pushing their OWN week from the dashboard when the
 * card tells them it isn't on their watch (bc77a4a2). Two copies of this would be
 * two sets of rules about when a delivery may be called a success, and the whole
 * value of the original is that it refuses to say so on anything less than a
 * read-back from Garmin.
 *
 * ⚠️ This function performs no authorization of its own. It writes training onto
 * a real person's watch, so every caller must already have established that it is
 * allowed to: the coach route requires staff, and the athlete route takes the
 * athlete id from the session and nowhere else.
 */

export interface PushResult {
  athleteId: string;
  athleteName: string;
  status: 'success' | 'failed';
  error?: string;
}

/** The athlete row shape this needs — the select lists in both callers must supply it. */
export interface PushTargetAthlete {
  id: string;
  name: string;
  garmin_auth?: unknown;
  is_academy?: boolean | null;
  groups?: { pace_profile?: unknown } | null;
}

export async function pushWeekToAthlete({
  supabase,
  athlete,
  plannedWorkouts,
  weekStartDate,
  planId,
  paceTarget,
  notify = true,
}: {
  supabase: ReturnType<typeof createServerClient>;
  athlete: PushTargetAthlete;
  plannedWorkouts: ParsedWorkout[];
  weekStartDate: string;
  planId: string | null;
  /** Whether to write pace-zone TARGETS (alerting) rather than info-only text. */
  paceTarget: boolean;
  /**
   * Send the athlete the "new workouts on your watch" push. False for a self-push:
   * they are holding the phone that just did it, so telling them is noise.
   */
  notify?: boolean;
}): Promise<PushResult> {
  try {
    if (!athlete.garmin_auth) {
      return {
        athleteId: athlete.id,
        athleteName: athlete.name,
        status: 'failed',
        error: 'No Garmin auth token',
      };
    }

    const garmin = new GarminClient(athlete.garmin_auth as any);
    // StoredPaceProfile, not PaceProfile: what comes back here is the club
    // group's `{ marathonGoal, offsetSeconds }`, and calling it a zone table
    // is what used to make the converter throw on a zone-only pace step.
    const paceProfile = (athlete.groups?.pace_profile || {}) as StoredPaceProfile;

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

    // Let the athlete know their watch has new workouts — previously
    // the only way to find out was to happen to check the app or watch;
    // pushing a plan was otherwise completely silent to them.
    //
    // Strictly after the verification above, and that ordering is the point:
    // this notification tells someone to expect training on their watch, so
    // it must not go out on a push we can't confirm Garmin actually has.
    if (notify) {
      try {
        await notifyAthlete({
          athleteId: athlete.id,
          kind: 'plan_pushed',
          copy: (locale) => planPushedCopy(locale, { count: plannedWorkouts.length }),
          url: '/dashboard/program',
          tag: `plan-push-${planId || weekStartDate}`,
          category: 'program',
        });
      } catch {
        // best-effort — never let a push failure affect the actual delivery result
      }
    }

    return { athleteId: athlete.id, athleteName: athlete.name, status: 'success' };
  } catch (error: any) {
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
    return {
      athleteId: athlete.id,
      athleteName: athlete.name,
      status: 'failed',
      error: error.message || 'Unknown error',
    };
  }
}
