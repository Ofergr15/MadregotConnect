/**
 * The maintenance rule, with no database attached.
 *
 * Split out of maintenance.ts so the browser can use it: that module opens a
 * service-role Supabase client at import time, and the admin roster needs to show
 * the club WHO is shut out right now. One rule shared by the API gate, the overlay
 * and the admin screens beats three that drift apart — and drift here means an
 * admin releasing somebody who was never blocked, or a screen saying "in" about a
 * member the API is answering 503 to.
 */

export interface MaintenanceState {
  on: boolean;
  /** Lower-cased addresses that may use the app while it is on. */
  allow: string[];
}

/**
 * Every handle that can identify one person to the allowlist.
 *
 * More than one, because a single address cannot do it. Login is Strava-only, so
 * the JWT email is ALWAYS the synthetic `strava_<id>@strava.madregot.local` — the
 * first version of this compared the allowlist against that and nothing else,
 * which meant no entry an admin could type would ever match, and turning
 * maintenance on locked out 100% of the club, admins included, with the off
 * switch behind the door. (Found in production 2026-09-07.)
 *
 * `athleteId` is the handle that always works and the one the admin screens write,
 * because plenty of members have no real address on their row either.
 */
export interface MaintenanceIdentity {
  /** The JWT address. Synthetic for a Strava login. */
  email?: string | null;
  /** The address on the athlete row — what a human would recognise. */
  athleteEmail?: string | null;
  athleteId?: string | null;
}

/**
 * Is this person shut out right now? Pure, so the rule is testable without a
 * database — and it is one rule, used by the API gate, the screen and the admin
 * views, rather than several that can drift.
 */
export function maintenanceBlocks(who: MaintenanceIdentity, state: MaintenanceState): boolean {
  if (!state.on) return false;
  const handles = [who.email, who.athleteEmail, who.athleteId]
    .map((h) => (h || '').toLowerCase().trim())
    .filter(Boolean);
  // No resolvable identity while maintenance is on is blocked, not exempt: the
  // allowlist cannot recognise somebody it knows nothing about.
  if (handles.length === 0) return true;
  return !handles.some((h) => state.allow.includes(h));
}
