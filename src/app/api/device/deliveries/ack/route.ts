import { deviceAuthError, requireDevice } from '@/lib/watch/require-device';
import { ackDeliveries } from '@/lib/watch/pending';
import { json, readJson } from '@/lib/watch/http';
import { notifyAthlete } from '@/lib/push';
import { watchOnWatchCopy } from '@/lib/notifications/watch-push-copy';

/**
 * POST /api/device/deliveries/ack — `{ scheduled?: id[], removed?: id[],
 * failed?: [{ deliveryId, error }] }`. Only the caller's own Apple rows move.
 * Scheduling is the moment an Apple delivery becomes 'success'.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireDevice(request);
  if (!auth.ok) return deviceAuthError(auth);
  const body = await readJson(request, 64 * 1024);
  if (!body) return json({ error: 'JSON body required' }, 400);
  try {
    const result = await ackDeliveries(auth.supabase, auth.device.athleteId, body);
    // Step 2 of 2 for Apple: the phone confirmed the workouts are scheduled on
    // the watch, so "on your watch" is now true. Best-effort, after the ack.
    if (result.scheduled > 0 && Array.isArray(body.scheduled)) {
      try {
        const { data } = await auth.supabase
          .from('workout_deliveries')
          .select('workout_date')
          .in('id', (body.scheduled as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 50))
          .eq('athlete_id', auth.device.athleteId)
          .eq('status', 'success');
        const dows = [...new Set((data || []).map((r: { workout_date: string }) => new Date(`${r.workout_date}T12:00:00Z`).getUTCDay()))];
        if (dows.length) {
          await notifyAthlete({
            athleteId: auth.device.athleteId,
            kind: 'plan_pushed',
            copy: (locale) => watchOnWatchCopy(locale, dows),
            url: '/dashboard/program',
            tag: `on-watch-${(data || []).map((r: { workout_date: string }) => r.workout_date).sort().join(',')}`,
            category: 'program',
          });
        }
      } catch { /* best-effort */ }
    }
    return json(result);
  } catch (error) {
    console.error('device ack error:', error);
    return json({ error: 'Failed to record acknowledgement' }, 500);
  }
}
