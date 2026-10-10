import { createServerClient } from '@/lib/supabase/server';
import { verifyAccessToken } from './device-auth';
import { hasWatchSchema, WATCH_TABLES } from './schema';
import type { Db } from './types';

/**
 * `requireDevice` — the device-side twin of `requireAthlete` (lib/auth-session.ts,
 * deliberately not edited: a parallel change owns it).
 *
 * The companion app sends `Authorization: Bearer wat1.…` (device-auth.ts). The
 * token's signature and expiry are checked without I/O; then ONE select confirms
 * the device still exists, is not revoked, belongs to the athlete the token
 * names, and that athlete is still an active member. That per-request read is
 * what makes "revoke" and "deactivate" immediate instead of up to 15 minutes late.
 *
 * Never consults view-as: a device is one athlete's phone, and there is nobody to
 * be viewing as.
 */

export interface DeviceUser {
  deviceId: string;
  athleteId: string;
}

export type DeviceAuthResult =
  | { ok: true; device: DeviceUser; supabase: Db }
  | { ok: false; status: number; error: string };

const SEEN_EVERY_MS = 5 * 60_000;

function bearer(request: Request): string {
  const header = request.headers.get('authorization') || '';
  return /^bearer\s+/i.test(header) ? header.replace(/^bearer\s+/i, '').trim() : '';
}

interface DeviceRow {
  id: string;
  athlete_id: string;
  revoked_at: string | null;
  last_seen_at: string | null;
  athletes: { status: string | null } | { status: string | null }[] | null;
}

export async function requireDevice(
  request: Request,
  { supabase = createServerClient(), now = Date.now() }: { supabase?: Db; now?: number } = {},
): Promise<DeviceAuthResult> {
  if (!(await hasWatchSchema(supabase))) return { ok: false, status: 404, error: 'watch-not-enabled' };

  const claims = verifyAccessToken(bearer(request), now);
  if (!claims) return { ok: false, status: 401, error: 'Invalid or expired device token' };

  const { data, error } = await supabase
    .from(WATCH_TABLES.devices)
    .select('id, athlete_id, revoked_at, last_seen_at, athletes!inner(status)')
    .eq('id', claims.deviceId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: 'Device lookup failed' };
  const row = data as DeviceRow | null;
  if (!row || row.revoked_at) return { ok: false, status: 401, error: 'Device revoked' };
  if (row.athlete_id !== claims.athleteId) return { ok: false, status: 401, error: 'Device token mismatch' };
  const athlete = Array.isArray(row.athletes) ? row.athletes[0] : row.athletes;
  if (athlete?.status !== 'active') return { ok: false, status: 403, error: 'Account is not active' };

  const seen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
  if (now - seen > SEEN_EVERY_MS) {
    // Best-effort bookkeeping; never fails the request.
    try {
      await supabase.from(WATCH_TABLES.devices).update({ last_seen_at: new Date(now).toISOString() }).eq('id', row.id);
    } catch {
      /* ignore */
    }
  }

  return { ok: true, device: { deviceId: row.id, athleteId: row.athlete_id }, supabase };
}

export function deviceAuthError(result: { status: number; error: string }): Response {
  return new Response(JSON.stringify({ error: result.error }), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
