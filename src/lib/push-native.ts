import { randomUUID } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import {
  computeUnreadCounts,
  filterByCategory,
  filterForMaintenance,
  recordDeliveries,
  type DeliveryRow,
  type PushPayload,
} from '@/lib/push';
import { apnsConfig, sendApns, type ApnsConfig, type ApnsTransport } from '@/lib/apns';
import { clearApnsTokens, nativeDevicesForAthletes, type NativePushDevice } from '@/lib/watch/devices';

/**
 * Native (APNs) counterpart of lib/push.ts `sendPushDetailed`, for the iPhone app's devices
 * (`athlete_devices.apns_token`, migration 138).
 *
 * It mirrors the web-push path step for step, so a native recipient is treated exactly like a
 * web one:
 *   1. not configured → nothing sent, said in the log (web: VAPID keys missing)
 *   2. maintenance allowlist (shared filterForMaintenance)
 *   3. the athlete's per-category mute (shared filterByCategory)
 *   4. per-athlete unread badge unless the caller pinned one (shared computeUnreadCounts)
 *   5. one push per device; one `push_deliveries` row per device (subscription_id null — it
 *      is not a web subscription — and error prefixed "apns:")
 *   6. dead tokens (410 / BadDeviceToken / DeviceTokenNotForTopic) cleared via the devices lib
 *      (web: the dead subscription row is deleted)
 *
 * Wired into notifyAthlete (lib/push.ts) only, and only when apnsConfig() is set: with no APNS_*
 * configuration the call is skipped before this module is even loaded. Turning it on needs the
 * APNs key in the server env, the app's aps-environment entitlement and its bundle id. Broadcasts
 * (sendPushLocalized) are not wired yet.
 */
export interface NativeSendResult {
  sent: number;
  byAthlete: Record<string, number>;
  /** Devices whose token APNs declared dead and that were cleared. */
  cleared: number;
  configured: boolean;
}

const EMPTY = (configured: boolean): NativeSendResult => ({ sent: 0, byAthlete: {}, cleared: 0, configured });

export async function sendPushNative(
  devices: NativePushDevice[],
  payload: PushPayload,
  opts: { config?: ApnsConfig | null; transport?: ApnsTransport } = {},
): Promise<NativeSendResult> {
  const cfg = opts.config === undefined ? apnsConfig() : opts.config;
  if (devices.length === 0) return EMPTY(!!cfg);
  if (!cfg) {
    console.warn(`[push-native] APNs not configured — dropped "${payload.title}" for ${devices.length} device(s)`);
    return EMPTY(false);
  }

  const nid = randomUUID();
  const deliveries: DeliveryRow[] = [];
  const kind = payload.kind ?? payload.category ?? null;
  const note = (list: NativePushDevice[], accepted: boolean, error: string | null) => {
    for (const d of list) deliveries.push({ nid, athlete_id: d.athlete_id || null, subscription_id: null, kind, title: payload.title.slice(0, 120), accepted, error });
  };

  let live = devices;
  const all = live;
  live = await filterForMaintenance(live);
  note(all.filter((d) => !live.includes(d)), false, 'apns:maintenance');
  const wanted = live;
  live = await filterByCategory(live, payload.category);
  note(wanted.filter((d) => !live.includes(d)), false, 'apns:muted');
  if (live.length === 0) {
    await recordDeliveries(deliveries);
    return EMPTY(true);
  }

  const athleteIds = [...new Set(live.map((d) => d.athlete_id).filter(Boolean))];
  const unread = payload.badge != null ? {} : await computeUnreadCounts(athleteIds);

  let sent = 0;
  const byAthlete: Record<string, number> = {};
  const dead: string[] = [];
  const failures: string[] = [];

  await Promise.all(
    live.map(async (d) => {
      const badge = payload.badge != null ? payload.badge : (unread[d.athlete_id] ?? 1);
      const result = await sendApns(
        d.apns_token,
        {
          title: payload.title,
          body: payload.body,
          url: payload.url,
          tag: payload.tag,
          badge,
          id: nid,
          data: { nid, athleteId: d.athlete_id, ...(kind ? { kind } : {}) },
        },
        { config: cfg, transport: opts.transport },
      );
      if (result.outcome === 'sent') {
        sent++;
        byAthlete[d.athlete_id] = (byAthlete[d.athlete_id] || 0) + 1;
        note([d], true, null);
        return;
      }
      note([d], false, `apns:${result.status ?? ''}:${result.reason ?? result.outcome}`.slice(0, 80));
      if (result.outcome === 'invalid-token') dead.push(d.id);
      else failures.push(`${d.id.slice(0, 8)}=${result.status ?? ''}${result.reason ? ` ${result.reason}` : ''}`);
    }),
  );

  const db = createServerClient();
  if (dead.length > 0) await clearApnsTokens(db, dead);
  await recordDeliveries(deliveries);
  if (failures.length > 0) console.warn(`[push-native] "${payload.title}": ${failures.length}/${live.length} failed — ${failures.join(', ')}`);
  return { sent, byAthlete, cleared: dead.length, configured: true };
}

/** Convenience: the athletes' push-capable devices, then sendPushNative. */
export async function sendPushNativeToAthletes(
  athleteIds: string[],
  payload: PushPayload,
  opts: { config?: ApnsConfig | null; transport?: ApnsTransport } = {},
): Promise<NativeSendResult> {
  const cfg = opts.config === undefined ? apnsConfig() : opts.config;
  if (!cfg) return EMPTY(false); // off: don't even read the device table
  const devices = await nativeDevicesForAthletes(createServerClient(), athleteIds);
  return sendPushNative(devices, payload, { ...opts, config: cfg });
}
