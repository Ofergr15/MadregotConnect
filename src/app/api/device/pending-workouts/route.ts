import { deviceAuthError, requireDevice } from '@/lib/watch/require-device';
import { pendingWorkouts } from '@/lib/watch/pending';
import { json } from '@/lib/watch/http';

/**
 * GET /api/device/pending-workouts — the Apple Watch delivery queue for the
 * device's athlete: what to schedule (WatchWorkoutV1 + the plan UUID to give
 * `WorkoutPlan(_:id:)`) and what to remove. See lib/watch/pending.ts and
 * docs/apple-watch.md. 404 until migration 136.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireDevice(request);
  if (!auth.ok) return deviceAuthError(auth);
  try {
    return json(await pendingWorkouts(auth.supabase, auth.device.athleteId));
  } catch (error) {
    console.error('device pending-workouts error:', error);
    return json({ error: 'Failed to read pending workouts' }, 500);
  }
}
