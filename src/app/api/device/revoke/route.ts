import { createServerClient } from '@/lib/supabase/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { hasWatchSchema, watchNotEnabled, WATCH_TABLES } from '@/lib/watch/schema';
import { hashToken, isDeviceAccessToken, revokeDevice } from '@/lib/watch/device-auth';
import { deviceAuthError, requireDevice } from '@/lib/watch/require-device';
import { json, readJson, str, UUID_RE } from '@/lib/watch/http';

/**
 * POST /api/device/revoke — sign a phone out. Three ways in, all ending in the
 * same `revokeDevice` (device row + every token it holds):
 *
 *   1. the device itself, with its access token          → revokes itself;
 *   2. `{ refreshToken }` with no auth header             → revokes the device
 *      that token belongs to (sign-out after the access token expired);
 *   3. the athlete's normal session + `{ deviceId }`      → revokes one of THEIR
 *      devices (a future "my devices" screen; lost phone).
 */
export const dynamic = 'force-dynamic';

function bearer(request: Request): string {
  const h = request.headers.get('authorization') || '';
  return /^bearer\s+/i.test(h) ? h.replace(/^bearer\s+/i, '').trim() : '';
}

export async function POST(request: Request) {
  const supabase = createServerClient();
  if (!(await hasWatchSchema(supabase))) return watchNotEnabled();

  const token = bearer(request);
  if (token && isDeviceAccessToken(token)) {
    const auth = await requireDevice(request, { supabase });
    if (!auth.ok) return deviceAuthError(auth);
    await revokeDevice(supabase, auth.device.deviceId);
    return json({ revoked: true });
  }

  const body = (await readJson(request, 16 * 1024)) || {};

  if (!token) {
    const refresh = str(body.refreshToken, 200);
    if (!refresh) return json({ error: 'refreshToken or authorization required' }, 400);
    const { data } = await supabase.from(WATCH_TABLES.tokens).select('device_id').eq('token_hash', hashToken(refresh)).maybeSingle();
    // Same answer whether or not the token existed: this must not be an oracle.
    if (data) await revokeDevice(supabase, (data as { device_id: string }).device_id);
    return json({ revoked: true });
  }

  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  if (auth.user.viewingAsBy) return json({ error: 'view-as cannot revoke a device' }, 403);
  const deviceId = str(body.deviceId, 64);
  if (!deviceId || !UUID_RE.test(deviceId)) return json({ error: 'deviceId required' }, 400);
  const { data: device } = await supabase
    .from(WATCH_TABLES.devices)
    .select('id')
    .eq('id', deviceId)
    .eq('athlete_id', auth.user.athleteId)
    .maybeSingle();
  if (!device) return json({ error: 'Device not found' }, 404);
  await revokeDevice(supabase, deviceId);
  return json({ revoked: true });
}
