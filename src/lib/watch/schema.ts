import type { Db } from './types';

/**
 * Is migration 136 applied here?
 *
 * Migrations are pasted by hand, so this code ships before its tables exist —
 * and every device route, and the Apple branch of a coach push, has to behave as
 * if the feature did not exist until they do. Same probe as
 * `hasTraineeCoachesTable` (lib/academy/trainee-coaches.ts): one cheap select,
 * any error ⇒ no.
 *
 * Cached per instance, briefly: a yes for 5 minutes, a no for 30 seconds, so the
 * first request after the paste picks it up quickly and a busy instance doesn't
 * probe on every call.
 */

export const WATCH_TABLES = {
  devices: 'athlete_devices',
  tokens: 'device_tokens',
} as const;

const YES_MS = 5 * 60_000;
const NO_MS = 30_000;
let cached: { value: boolean; until: number } | null = null;

export async function hasWatchSchema(supabase: Db, now = Date.now()): Promise<boolean> {
  if (cached && cached.until > now) return cached.value;
  let value = false;
  try {
    const devices = await supabase.from(WATCH_TABLES.devices).select('id').limit(1);
    // The delivery columns are part of the same paste; probing one of them too
    // keeps a half-applied 136 (tables but no columns) reading as "not yet".
    const deliveries = devices.error
      ? devices
      : await supabase.from('workout_deliveries').select('provider_plan_id').limit(1);
    value = !devices.error && !deliveries.error;
  } catch {
    value = false;
  }
  cached = { value, until: now + (value ? YES_MS : NO_MS) };
  return value;
}

/** For tests, and for a route that has just applied the schema in the lab. */
export function resetWatchSchemaCache(): void {
  cached = null;
}

/** The answer every device route gives before 136: the feature isn't here. */
export function watchNotEnabled(): Response {
  return new Response(JSON.stringify({ error: 'watch-not-enabled' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}
