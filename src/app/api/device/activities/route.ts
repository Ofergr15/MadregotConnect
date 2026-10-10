import { deviceAuthError, requireDevice } from '@/lib/watch/require-device';
import { ingestAppleActivity, validateAppleUpload } from '@/lib/watch/activity-ingest';
import { json, readJson } from '@/lib/watch/http';

/**
 * POST /api/device/activities — one finished Apple Watch run (AppleActivityUploadV1,
 * docs/apple-watch.md). Idempotent on `appleWorkoutUuid`; a Strava copy of the
 * same run is upgraded to the Apple recording, a Garmin copy wins. Then the plan
 * is matched — by the WorkoutKit plan id first, then the usual heuristic.
 *
 * 201 for a new row, 200 for everything else (duplicate / upgraded / skipped),
 * so the app can treat any 2xx as "delivered, stop retrying".
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function afterIngest(athleteId: string, shoeId: string | null) {
  const [{ checkAndAwardBadges }, { checkAndAwardChallenges }, { checkShoeAlert }] = await Promise.all([
    import('@/lib/badges/award-engine'),
    import('@/lib/challenges/engine'),
    import('@/lib/shoes'),
  ]);
  if (shoeId) await checkShoeAlert(shoeId).catch(() => undefined);
  await checkAndAwardBadges(athleteId).catch(() => undefined);
  await checkAndAwardChallenges(athleteId).catch(() => undefined);
}

export async function POST(request: Request) {
  const auth = await requireDevice(request);
  if (!auth.ok) return deviceAuthError(auth);

  const body = await readJson(request, 4 * 1024 * 1024);
  if (!body) return json({ error: 'JSON body required (max 4 MB)' }, 400);
  const checked = validateAppleUpload(body);
  if (!checked.ok) return json({ error: checked.error }, 422);

  try {
    const result = await ingestAppleActivity(auth.supabase, auth.device.athleteId, checked.upload, { after: afterIngest });
    return json(result, result.status === 'inserted' ? 201 : 200);
  } catch (error) {
    console.error('device activity upload error:', error);
    return json({ error: 'Failed to store activity' }, 500);
  }
}
