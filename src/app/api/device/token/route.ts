import { createServerClient } from '@/lib/supabase/server';
import { hasWatchSchema, watchNotEnabled, WATCH_TABLES } from '@/lib/watch/schema';
import { rotateRefreshToken, signAccessToken } from '@/lib/watch/device-auth';
import { devicePatchFrom } from '@/lib/watch/devices';
import { json, readJson, str } from '@/lib/watch/http';

/**
 * POST /api/device/token — refresh token in, short access token (15 min) and the
 * NEXT refresh token out. The presented refresh token is spent; see
 * lib/watch/device-auth.ts for the 120 s retry grace and reuse revocation.
 *
 * The app calls this on every launch and background wake, so it also carries the
 * device's current state (app version, APNs token, WorkoutKit/HealthKit
 * authorization) — which is what tells the server whether this athlete can be
 * delivered to at all (scheduler_authorized).
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const supabase = createServerClient();
  if (!(await hasWatchSchema(supabase))) return watchNotEnabled();

  const body = await readJson(request, 16 * 1024);
  const presented = str(body?.refreshToken, 200);
  if (!body || !presented) return json({ error: 'refreshToken required' }, 400);

  const rotated = await rotateRefreshToken(supabase, presented);
  if (!rotated.ok) {
    return json({ error: rotated.reason === 'error' ? 'Could not refresh' : `refresh-${rotated.reason}` }, rotated.reason === 'error' ? 500 : 401);
  }

  const { data: athlete } = await supabase.from('athletes').select('status').eq('id', rotated.athleteId).maybeSingle();
  if ((athlete as { status?: string } | null)?.status !== 'active') return json({ error: 'Account is not active' }, 403);

  const access = signAccessToken({ deviceId: rotated.deviceId, athleteId: rotated.athleteId });
  if (!access) return json({ error: 'Device credentials unavailable' }, 500);

  const patch = devicePatchFrom(body);
  await supabase
    .from(WATCH_TABLES.devices)
    .update({ ...patch, last_seen_at: new Date().toISOString() })
    .eq('id', rotated.deviceId);

  return json({ accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken: rotated.refreshToken });
}
