/**
 * When "opening the app pulls in my new Strava runs" is allowed to happen again.
 *
 * Strava is the one data source with no server-side schedule behind it. The
 * 5-minute cron syncs Garmin and then runs two Strava *repair* passes over rows
 * that already exist (routes, laps) — it deliberately does not poll Strava for
 * new activities, dropped 2026-08-28 back when every member was on Garmin and
 * the poll matched nobody. The webhook added 2026-08-23 was meant to replace it
 * with something better than a poll, and measured on production 2026-09-11 it has
 * never delivered a single event: of 638 Strava rows stored since the poll was
 * dropped, not one arrived within half an hour of the run finishing, while the
 * last row that did arrive promptly (3 minutes) predates the drop.
 *
 * So in practice a Strava member's runs arrive exactly when their own phone asks
 * for them, and that made two small bugs into "my runs stopped coming in":
 *
 *   1. The trigger lived only on /dashboard, and the installed PWA's front door
 *      is /feed (manifest start_url). A member who lives in the feed — which is
 *      where the app opens — never reached it.
 *   2. It was gated on a bare localStorage flag written on success and removed
 *      only on failure, so a SUCCESSFUL sync disarmed it permanently: once per
 *      athlete per browser, ever. Its own comment ("re-arm so it retries next
 *      visit") shows it was meant to be a duplicate-launch guard for React Strict
 *      Mode, not a lifetime lock. clearIdentityKeys() could not save it either —
 *      that list carries the bare key name 'dashboard_synced', while the value
 *      actually written is `dashboard_synced:<athleteId>`.
 *
 * Hence a timestamp rather than a flag, and a cooldown rather than "ever". The
 * gate is a pure function so both callers (the shared app shell, and the
 * dashboard's own snapshot→sync→"customize your post" flow) ask the same
 * question, and so the boundary is testable without a browser.
 */

/** `strava_open_sync_at:<athleteId>` — an epoch-ms stamp of the last attempt. */
export const STRAVA_OPEN_SYNC_PREFIX = 'strava_open_sync_at:';

/**
 * The key the dashboard used to write. Still swept on sign-out (see
 * identity-keys.ts) so a per-athlete value cannot outlive the athlete on a
 * shared phone; nothing writes it any more.
 */
export const LEGACY_DASHBOARD_SYNC_PREFIX = 'dashboard_synced:';

/**
 * How long after an attempt the next app open is allowed to sync again.
 *
 * The cost of being wrong in each direction is asymmetric. Too long and a member
 * who finishes a run, uploads it and opens the app still sees nothing — the
 * complaint this whole file is about. Too short and every screen change could
 * spend a Strava round trip against a 100-per-15-minutes limit shared by the
 * whole club. Ten minutes is shorter than the gap between finishing a run and
 * getting to your phone, and it caps a heavy app session at six syncs an hour for
 * one member.
 */
export const OPEN_SYNC_COOLDOWN_MS = 10 * 60 * 1000;

export function stravaOpenSyncKey(athleteId: string): string {
  return `${STRAVA_OPEN_SYNC_PREFIX}${athleteId}`;
}

/**
 * Is a Strava sync due, given whatever the last attempt left in localStorage?
 *
 * Anything that isn't a usable timestamp means "due", which is deliberate rather
 * than defensive noise:
 *
 *   • null/'' — never synced on this device.
 *   • '1' — the old flag. Reading it as a number puts the last sync one
 *     millisecond after 1970, so every device still carrying one syncs on its
 *     next app open instead of needing a migration or a cache clear.
 *   • a future stamp — a phone whose clock was wrong when it was written, or one
 *     that has since moved back. A stamp we cannot reason about must not be able
 *     to lock syncing off; the worst case of treating it as due is one extra
 *     request, and it self-corrects the moment it is rewritten.
 */
export function shouldSyncOnOpen(
  stored: string | null | undefined,
  now: number,
  cooldownMs: number = OPEN_SYNC_COOLDOWN_MS,
): boolean {
  if (!stored) return true;
  const last = Number(stored);
  if (!Number.isFinite(last) || last <= 0) return true;
  if (last > now) return true;
  return now - last >= cooldownMs;
}
