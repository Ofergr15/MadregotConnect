import { randomUUID } from 'crypto';
import type { ParsedWorkout } from '@/lib/ai/types';
import type { StoredPaceProfile } from '@/lib/garmin/types';
import { serializeWatchWorkout, type WatchWorkoutV1 } from '../serialize';
import { hasWatchSchema, WATCH_TABLES } from '../schema';
import type { Db, DeliverWeekInput, DeliverWeekResult, WatchProviderAdapter, WatchTargetAthlete } from '../types';

/**
 * Apple Watch delivery: write the week for the athlete's iPhone to collect.
 *
 * There is no Apple server to push to. WorkoutKit's `WorkoutScheduler` exists
 * only on the device, so a "delivery" here is a `workout_deliveries` row with
 * `provider='apple'`, a WatchWorkoutV1 in `workout_data`, and a
 * `provider_plan_id` — the UUID the app passes to `WorkoutPlan(_:id:)`, which
 * HealthKit hands back on the finished run (`HKWorkout.workoutPlan`). That id is
 * what attributes the run to this exact plan slot (match-athlete-activities.ts).
 *
 * Rows go in as 'pending' and stay that way until the phone acks that it
 * scheduled them (`POST /api/device/deliveries/ack`) — the same honesty rule the
 * Garmin path keeps with its read-back: 'success' means on the watch, and is the
 * only status `/api/my-watch` reports.
 *
 * Re-pushing is idempotent per (plan, date, workoutKey): the same content keeps
 * its row and its plan id, so the phone has nothing to do; changed content
 * supersedes the old row (the phone is told to remove it) and gets a new id; a
 * part no longer in the push on a date that IS in the push is superseded too —
 * Garmin's "clear that day's earlier workouts" rule, applied per date.
 */

interface LiveRow {
  id: string;
  workout_date: string;
  workout_key: string | null;
  workout_data: Partial<WatchWorkoutV1> | null;
}

/** Same calendar math as lib/garmin/push-week.ts, so both providers land on the same date. */
export function workoutDate(weekStartDate: string, dayOfWeek: number): string {
  const startDate = new Date(weekStartDate);
  startDate.setDate(startDate.getDate() + dayOfWeek);
  return startDate.toISOString().split('T')[0];
}

/**
 * athletes.max_hr_bpm (migration 103), read here rather than added to the push
 * routes' athlete select — that select is the Garmin path's, and it stays as it is.
 */
async function loadMaxHr(supabase: Db, athleteId: string): Promise<number | null> {
  try {
    const { data } = await supabase.from('athletes').select('max_hr_bpm').eq('id', athleteId).maybeSingle();
    const value = Number((data as { max_hr_bpm?: unknown } | null)?.max_hr_bpm);
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

const keyOf = (w: ParsedWorkout, i: number) => w.workoutKey || `idx-${w.dayOfWeek}-${i}`;

export async function enqueueAppleWeek(
  input: DeliverWeekInput,
  now = new Date(),
): Promise<{ inserted: number; kept: number; superseded: number }> {
  const { supabase, athlete, plannedWorkouts, weekStartDate, planId, paceTarget } = input;
  const paceProfile = (athlete.groups?.pace_profile || {}) as StoredPaceProfile;
  const maxHrBpm = athlete.max_hr_bpm !== undefined ? athlete.max_hr_bpm : await loadMaxHr(supabase, athlete.id);

  const planned = plannedWorkouts.map((w, i) => ({
    key: keyOf(w, i),
    date: workoutDate(weekStartDate, w.dayOfWeek),
    workout: serializeWatchWorkout(w, { paceProfile, maxHrBpm, alerts: paceTarget }),
  }));
  const dates = [...new Set(planned.map((p) => p.date))];
  if (dates.length === 0) return { inserted: 0, kept: 0, superseded: 0 };

  let query = supabase
    .from('workout_deliveries')
    .select('id, workout_date, workout_key, workout_data')
    .eq('athlete_id', athlete.id)
    .eq('provider', 'apple')
    .in('workout_date', dates)
    .is('superseded_at', null)
    .in('status', ['pending', 'success']);
  query = planId ? query.eq('plan_id', planId) : query.is('plan_id', null);
  const { data: liveData, error: liveError } = await query;
  if (liveError) throw new Error(`Could not read Apple deliveries: ${liveError.message}`);
  const live = (liveData || []) as LiveRow[];

  const stamp = now.toISOString();
  const supersede: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  const claimed = new Set<string>();
  let kept = 0;

  for (const p of planned) {
    const same = live.filter((r) => r.workout_date === p.date && r.workout_key === p.key);
    const keep = same.find((r) => r.workout_data?.hash === p.workout.hash && !claimed.has(r.id));
    if (keep) {
      claimed.add(keep.id);
      kept++;
      continue;
    }
    inserts.push({
      plan_id: planId,
      athlete_id: athlete.id,
      workout_date: p.date,
      workout_key: p.key,
      workout_data: p.workout,
      status: 'pending',
      provider: 'apple',
      provider_plan_id: randomUUID(),
    });
  }
  // Everything live on a pushed date that this push didn't keep is out of date.
  for (const r of live) if (!claimed.has(r.id)) supersede.push(r.id);

  // New rows first: a failure between the two writes leaves the old version
  // live (the phone keeps it) rather than nothing at all.
  if (inserts.length) {
    const { error } = await supabase.from('workout_deliveries').insert(inserts);
    if (error) throw new Error(`Could not queue Apple deliveries: ${error.message}`);
  }
  if (supersede.length) {
    const { error } = await supabase
      .from('workout_deliveries')
      .update({ superseded_at: stamp })
      .in('id', supersede);
    if (error) throw new Error(`Could not supersede Apple deliveries: ${error.message}`);
  }
  return { inserted: inserts.length, kept, superseded: supersede.length };
}

/** Athletes (from `ids`) with a live, scheduler-authorized Apple device. Empty before 138. */
export async function loadAppleAthleteIds(supabase: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    if (!(await hasWatchSchema(supabase))) return new Set();
    const { data, error } = await supabase
      .from(WATCH_TABLES.devices)
      .select('athlete_id')
      .in('athlete_id', ids)
      .is('revoked_at', null)
      .eq('scheduler_authorized', true);
    if (error || !Array.isArray(data)) return new Set();
    return new Set((data as Array<{ athlete_id: string }>).map((r) => r.athlete_id));
  } catch {
    return new Set();
  }
}

export const appleProvider: WatchProviderAdapter = {
  id: 'apple',
  isConnected: (athlete: WatchTargetAthlete, ctx) => !!ctx?.appleAthleteIds?.has(athlete.id),
  async deliverWeek(input: DeliverWeekInput): Promise<DeliverWeekResult> {
    const base = { athleteId: input.athlete.id, athleteName: input.athlete.name, provider: 'apple' as const };
    try {
      if (!(await hasWatchSchema(input.supabase))) {
        return { ...base, status: 'failed', error: 'Apple Watch delivery is not enabled yet' };
      }
      await enqueueAppleWeek(input);
      // No "new workouts on your watch" push: they are not on the watch until the
      // phone acks. Phase 2 wakes the app with a silent APNs instead.
      return { ...base, status: 'success', queued: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (input.planId) {
        try {
          await input.supabase.from('workout_deliveries').insert({
            plan_id: input.planId,
            athlete_id: input.athlete.id,
            workout_date: input.weekStartDate,
            workout_data: {},
            status: 'failed',
            error_message: message,
            provider: 'apple',
          });
        } catch {
          /* the failure is already being reported */
        }
      }
      return { ...base, status: 'failed', error: message };
    }
  },
};
