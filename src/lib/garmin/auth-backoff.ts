// Garmin auth-failure backoff (round-4 task 94). Pure.
//
// A refused Garmin credential used to be retried by the broadcast sync every 5 minutes, forever:
// ~288 refused logins a day per athlete, which is exactly the pattern Garmin's SSO rate-limits
// (and can lock the account for). Now, once the credential is refused (`garmin_auth_failed_at`
// newer than the last good sync), the broadcast pass backs off by how long it has been failing:
//
//   failing < 1 h   → every tick (a Garmin blip that looked like a 401 heals itself here)
//   1 h – 24 h      → once an hour
//   ≥ 24 h          → once every 6 hours
//
// No new column: `garmin_auth_failed_at` keeps the FIRST failure of the current streak (a repeat
// failure doesn't move it), so "failing for how long" is now − failedAt. Which tick runs the
// retry is a fixed slot per athlete (hash of the id), so the retries spread out instead of
// landing on the same tick. A member-initiated sync (one athleteId) and a reconnect always try.
//
// The member sees `garminState: 'failed'` + `garminReconnect` on /api/athletes/me — the one
// state that asks them to act.

export const TICK_MS = 5 * 60_000;
const HOUR = 3_600_000;

export type BackoffTier = 'every_tick' | 'hourly' | 'six_hourly';

/** True while the latest word on the credential is a refusal (same rule as connectionState). */
export function isAuthFailing(failedAt: string | null | undefined, syncedAt: string | null | undefined): boolean {
  const f = failedAt ? Date.parse(failedAt) : NaN;
  if (Number.isNaN(f)) return false;
  const s = syncedAt ? Date.parse(syncedAt) : NaN;
  return Number.isNaN(s) || f > s;
}

export function backoffTier(failingForMs: number): BackoffTier {
  if (failingForMs < HOUR) return 'every_tick';
  if (failingForMs < 24 * HOUR) return 'hourly';
  return 'six_hourly';
}

function slotOf(id: string, n: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % n;
}

/** Should the broadcast pass try this athlete on the tick that contains `nowMs`? */
export function shouldAttemptGarmin(
  a: { id: string; garmin_auth_failed_at?: string | null; garmin_last_sync_at?: string | null },
  nowMs: number,
): boolean {
  if (!isAuthFailing(a.garmin_auth_failed_at, a.garmin_last_sync_at)) return true;
  const tier = backoffTier(nowMs - Date.parse(a.garmin_auth_failed_at as string));
  if (tier === 'every_tick') return true;
  const tick = Math.floor(nowMs / TICK_MS);
  const period = tier === 'hourly' ? 12 : 72; // ticks per hour / per 6 hours
  return tick % period === slotOf(a.id, period);
}

/** When the broadcast pass will next try (for the member's "we'll retry at" line). Null = next tick. */
export function nextGarminAttemptAt(
  a: { id: string; garmin_auth_failed_at?: string | null; garmin_last_sync_at?: string | null },
  nowMs: number,
): string | null {
  if (!isAuthFailing(a.garmin_auth_failed_at, a.garmin_last_sync_at)) return null;
  for (let t = 0; t <= 72; t++) {
    const at = (Math.floor(nowMs / TICK_MS) + t) * TICK_MS;
    if (t > 0 && shouldAttemptGarmin(a, at)) return new Date(at).toISOString();
  }
  return null;
}

/** The member-facing reconnect state. */
export function garminReconnect(
  a: { id: string; garmin_auth?: unknown; garmin_auth_failed_at?: string | null; garmin_last_sync_at?: string | null },
  nowMs: number,
): { needed: boolean; since: string | null; nextRetryAt: string | null } {
  if (!a.garmin_auth || !isAuthFailing(a.garmin_auth_failed_at, a.garmin_last_sync_at)) return { needed: false, since: null, nextRetryAt: null };
  return { needed: true, since: a.garmin_auth_failed_at ?? null, nextRetryAt: nextGarminAttemptAt(a, nowMs) };
}
