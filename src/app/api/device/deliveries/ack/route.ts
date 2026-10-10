import { deviceAuthError, requireDevice } from '@/lib/watch/require-device';
import { ackDeliveries } from '@/lib/watch/pending';
import { json, readJson } from '@/lib/watch/http';

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
    return json(await ackDeliveries(auth.supabase, auth.device.athleteId, body));
  } catch (error) {
    console.error('device ack error:', error);
    return json({ error: 'Failed to record acknowledgement' }, 500);
  }
}
