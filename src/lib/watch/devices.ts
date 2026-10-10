import { issueRefreshToken, signAccessToken } from './device-auth';
import { WATCH_TABLES } from './schema';
import { bool, str } from './http';
import type { Db } from './types';

/** Live devices an athlete may hold at once; registering past it retires the oldest. */
export const MAX_LIVE_DEVICES = 5;

export interface DeviceStatePatch {
  app_version?: string | null;
  os_version?: string | null;
  device_name?: string | null;
  apns_token?: string | null;
  scheduler_authorized?: boolean;
  health_authorized?: boolean;
}

/** The device-reported fields a client may set, validated; unknown keys are ignored. */
export function devicePatchFrom(body: Record<string, unknown>): DeviceStatePatch {
  const patch: DeviceStatePatch = {};
  if ('appVersion' in body) patch.app_version = str(body.appVersion, 40);
  if ('osVersion' in body) patch.os_version = str(body.osVersion, 40);
  if ('deviceName' in body) patch.device_name = str(body.deviceName, 80);
  if ('apnsToken' in body) {
    const t = str(body.apnsToken, 200);
    patch.apns_token = t && /^[0-9a-f]{32,200}$/i.test(t) ? t.toLowerCase() : null;
  }
  const sched = bool(body.schedulerAuthorized);
  if (sched !== undefined) patch.scheduler_authorized = sched;
  const health = bool(body.healthAuthorized);
  if (health !== undefined) patch.health_authorized = health;
  return patch;
}

export interface Registration {
  deviceId: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: string;
}

export async function registerDevice(
  db: Db,
  athleteId: string,
  body: Record<string, unknown>,
  now = Date.now(),
): Promise<Registration | { error: string; status: number }> {
  if (body.platform !== undefined && body.platform !== 'ios') return { error: 'unsupported-platform', status: 400 };
  const installationId = str(body.installationId, 100);
  if (!installationId) return { error: 'installationId required', status: 400 };
  const at = new Date(now).toISOString();

  // Re-installing (or re-signing-in on) the same app instance replaces its old
  // registration instead of stacking a second one.
  const { data: same } = await db
    .from(WATCH_TABLES.devices)
    .select('id')
    .eq('athlete_id', athleteId)
    .eq('installation_id', installationId)
    .is('revoked_at', null);
  for (const d of (same || []) as Array<{ id: string }>) {
    await db.from(WATCH_TABLES.devices).update({ revoked_at: at }).eq('id', d.id);
    await db.from(WATCH_TABLES.tokens).update({ revoked_at: at }).eq('device_id', d.id).is('revoked_at', null);
  }

  const { data: created, error } = await db
    .from(WATCH_TABLES.devices)
    .insert({
      athlete_id: athleteId,
      platform: 'ios',
      installation_id: installationId,
      last_seen_at: at,
      ...devicePatchFrom(body),
    })
    .select('id')
    .single();
  if (error || !created) return { error: 'Could not register device', status: 500 };
  const deviceId = (created as { id: string }).id;

  const refresh = await issueRefreshToken(db, deviceId, now);
  const access = signAccessToken({ deviceId, athleteId }, now);
  if (!refresh || !access) {
    await db.from(WATCH_TABLES.devices).update({ revoked_at: at }).eq('id', deviceId);
    return { error: 'Device credentials unavailable', status: 500 };
  }

  // Keep the newest MAX_LIVE_DEVICES.
  const { data: live } = await db
    .from(WATCH_TABLES.devices)
    .select('id, created_at')
    .eq('athlete_id', athleteId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  // The one just created is kept whatever the clock says; the rest newest first.
  const others = ((live || []) as Array<{ id: string }>).map((d) => d.id).filter((id) => id !== deviceId);
  const extra = others.slice(MAX_LIVE_DEVICES - 1);
  for (const id of extra) {
    await db.from(WATCH_TABLES.devices).update({ revoked_at: at }).eq('id', id);
    await db.from(WATCH_TABLES.tokens).update({ revoked_at: at }).eq('device_id', id).is('revoked_at', null);
  }

  return { deviceId, refreshToken: refresh.token, accessToken: access.token, accessTokenExpiresAt: access.expiresAt };
}
