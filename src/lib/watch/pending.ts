import { israelToday } from '@/lib/utils';
import type { WatchWorkoutV1 } from './serialize';
import { UUID_RE } from './http';
import type { Db } from './types';

/**
 * What the phone should have scheduled, and what it should take off.
 *
 * The window is yesterday … a week from today (Israel dates): WorkoutKit's
 * scheduler shows ±7 days on the watch and holds at most 15 plans
 * (`WorkoutScheduler.maxAllowedScheduledWorkoutCount`, 15 per WWDC23), so the
 * nearest 15 are returned, earliest first. Yesterday stays in so a run finished
 * late at night still has its plan on the phone when HealthKit wakes the app.
 */

export const MAX_SCHEDULED = 15;

export interface PendingWorkout {
  deliveryId: string;
  planId: string;
  date: string;
  scheduledAt: { date: string; hour: number; minute: number };
  status: 'pending' | 'success';
  workout: WatchWorkoutV1;
}

export interface PendingResponse {
  serverTime: string;
  window: { from: string; to: string };
  maxScheduled: number;
  workouts: PendingWorkout[];
  remove: Array<{ deliveryId: string; planId: string; date: string }>;
}

interface Row {
  id: string;
  provider_plan_id: string | null;
  workout_date: string;
  workout_key: string | null;
  workout_data: WatchWorkoutV1 | null;
  status: 'pending' | 'success';
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const partIndexOf = (key: string | null) => Number(/part-(\d+)/.exec(key || '')?.[1] || 1);

/** A time of day for WorkoutScheduler.schedule(_:at:) — morning parts in order, an evening part at 18:00. */
export function scheduledTime(date: string, workout: WatchWorkoutV1 | null, key: string | null) {
  if (workout?.partKind === 'evening') return { date, hour: 18, minute: 0 };
  return { date, hour: 6, minute: Math.min(59, Math.max(0, partIndexOf(key) - 1)) };
}

export async function pendingWorkouts(db: Db, athleteId: string, now = new Date()): Promise<PendingResponse> {
  const today = israelToday(now);
  const from = addDays(today, -1);
  const to = addDays(today, 7);
  const cols = 'id, provider_plan_id, workout_date, workout_key, workout_data, status';

  const { data: liveData, error } = await db
    .from('workout_deliveries')
    .select(cols)
    .eq('athlete_id', athleteId)
    .eq('provider', 'apple')
    .is('superseded_at', null)
    .in('status', ['pending', 'success'])
    .gte('workout_date', from)
    .lte('workout_date', to)
    .order('workout_date', { ascending: true });
  if (error) throw new Error(error.message);

  const { data: goneData, error: goneError } = await db
    .from('workout_deliveries')
    .select(cols)
    .eq('athlete_id', athleteId)
    .eq('provider', 'apple')
    .not('superseded_at', 'is', null)
    .is('removed_at', null)
    .in('status', ['pending', 'success'])
    .gte('workout_date', from);
  if (goneError) throw new Error(goneError.message);

  const valid = (r: Row) => !!r.provider_plan_id && UUID_RE.test(r.provider_plan_id) && r.workout_data?.schema === 'madregot.watch-workout';
  const live = ((liveData || []) as Row[])
    .filter(valid)
    .sort((a, b) => (a.workout_date === b.workout_date ? partIndexOf(a.workout_key) - partIndexOf(b.workout_key) : a.workout_date < b.workout_date ? -1 : 1))
    .slice(0, MAX_SCHEDULED);

  return {
    serverTime: now.toISOString(),
    window: { from, to },
    maxScheduled: MAX_SCHEDULED,
    workouts: live.map((r) => ({
      deliveryId: r.id,
      planId: r.provider_plan_id!,
      date: r.workout_date,
      scheduledAt: scheduledTime(r.workout_date, r.workout_data, r.workout_key),
      status: r.status,
      workout: r.workout_data!,
    })),
    remove: ((goneData || []) as Row[])
      .filter((r) => !!r.provider_plan_id)
      .map((r) => ({ deliveryId: r.id, planId: r.provider_plan_id!, date: r.workout_date })),
  };
}

const MAX_ACK = 50;

const ids = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))].slice(0, MAX_ACK) : [];

/**
 * The phone's report back. Only the caller's own Apple rows can move:
 *   scheduled → status 'success' (the only status /api/my-watch calls "on the watch");
 *   removed   → removed_at, for superseded rows the phone took off;
 *   failed    → status 'failed' + the phone's reason (e.g. an alert WorkoutKit refused).
 */
export async function ackDeliveries(
  db: Db,
  athleteId: string,
  body: Record<string, unknown>,
  now = new Date(),
): Promise<{ scheduled: number; removed: number; failed: number }> {
  const scheduledIds = ids(body.scheduled);
  const removedIds = ids(body.removed);
  const failures = Array.isArray(body.failed)
    ? (body.failed as Array<{ deliveryId?: unknown; error?: unknown }>)
      .filter((f) => f && typeof f.deliveryId === 'string' && UUID_RE.test(f.deliveryId))
      .slice(0, MAX_ACK)
    : [];

  const mine = () => db.from('workout_deliveries');
  let scheduled = 0;
  let removed = 0;
  let failed = 0;

  if (scheduledIds.length) {
    const { data } = await mine()
      .update({ status: 'success', error_message: null })
      .in('id', scheduledIds)
      .eq('athlete_id', athleteId)
      .eq('provider', 'apple')
      .is('superseded_at', null)
      .select('id');
    scheduled = (data || []).length;
  }
  if (removedIds.length) {
    const { data } = await mine()
      .update({ removed_at: now.toISOString() })
      .in('id', removedIds)
      .eq('athlete_id', athleteId)
      .eq('provider', 'apple')
      .not('superseded_at', 'is', null)
      .select('id');
    removed = (data || []).length;
  }
  for (const f of failures) {
    const message = typeof f.error === 'string' ? f.error.slice(0, 300) : 'Device could not schedule the workout';
    const { data } = await mine()
      .update({ status: 'failed', error_message: `apple: ${message}` })
      .eq('id', f.deliveryId as string)
      .eq('athlete_id', athleteId)
      .eq('provider', 'apple')
      .is('superseded_at', null)
      .select('id');
    failed += (data || []).length;
  }
  return { scheduled, removed, failed };
}
