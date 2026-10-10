// "View as this person" — an admin sees the whole app exactly as one member does,
// read-only (2026-10-06 for the academy, the whole app since 2026-10-09). Shared by
// the server (requireSession) and the client (bearerHeaders, the chooser, the
// banner), so the header name and the rules about who and where live in one place.
//
// Unlike the older role preview (lib/impersonation.ts), which only changes what
// is DRAWN, this changes who the server answers as: the request carries the
// admin's own verified token plus `x-view-as: <athleteId>`, and requireSession
// hands the route that athlete's session instead. Four limits:
//
//   - admins only (role admin, or the super user), checked on every request off
//     the REAL session; anybody else's header is ignored;
//   - reads only: any other method while viewing is refused (403
//     `view_as_read_only`), so viewing can never write as somebody else, and the
//     GET routes that write as a side effect check `viewingAsBy` and skip it;
//   - every /api/ route except VIEW_AS_DENY below, /api/auth/me included — so the
//     nav, the page permissions and every screen are the viewed person's;
//   - nothing that MINTS an identity for them: no Stream token (a POST, so already
//     refused), no push subscription, no analytics (the client skips those).

export const VIEW_AS_HEADER = 'x-view-as';

/**
 * Where the header means nothing, and the real signed-in admin answers. Each one
 * is a door that establishes, refreshes or tears down the REAL session or a
 * provider credential, or one the admin needs as themselves while viewing:
 *
 *   /api/cron/            secret-authenticated jobs; no session to swap.
 *   /api/auth/            sign-in, silent re-auth, device token, email code,
 *                         resolve-role, claim, sign-out. Answering any of them as
 *                         the viewed person would mint, rotate or drop THEIR
 *                         credentials (createSyntheticSession rotates a password).
 *                         /api/auth/me is the one exception, see VIEW_AS_ALLOW.
 *   /api/strava/callback, /api/strava/webhook, /api/garmin/sso-callback,
 *   /api/garmin/ticket-auth, /api/garmin/authenticate
 *                         OAuth and provider logins: they store tokens on a row.
 *   /api/webhooks/        third parties calling in; no session at all.
 *   /api/dev/             the dev bar's own sign-in and fixtures.
 *   /api/maintenance      the gate stays the admin's, so viewing a member during
 *                         maintenance cannot lock the admin out of their own exit.
 *                         The role chooser's maintenance scenario previews it.
 *   /api/admin/view-as    the chooser's own listing: admin-only, so while viewing
 *                         a member it has to be answered as the admin, or the
 *                         chooser could never switch to somebody else.
 */
export const VIEW_AS_DENY = [
  '/api/cron/',
  '/api/auth/',
  '/api/strava/callback',
  '/api/strava/webhook',
  '/api/garmin/sso-callback',
  '/api/garmin/ticket-auth',
  '/api/garmin/authenticate',
  '/api/webhooks/',
  '/api/dev/',
  '/api/maintenance',
  '/api/admin/view-as',
];

/** Inside a denied prefix, but the whole point: the nav's bootstrap read. */
const VIEW_AS_ALLOW = ['/api/auth/me'];

export function viewAsApplies(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false;
  if (VIEW_AS_ALLOW.includes(pathname)) return true;
  return !VIEW_AS_DENY.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

/** An athlete id is a uuid; anything else is not worth a lookup. */
export function looksLikeAthleteId(value: string | null | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * What a person is, for the chooser's tag and the banner — the most specific of
 * the roles they hold. Pure, so the listing route and the tests agree on it.
 */
export type ViewAsTag = 'admin' | 'academy_manager' | 'academy_coach' | 'coach' | 'trainee' | 'runner';

export function viewAsTag(roles: readonly string[], isAcademy: boolean): ViewAsTag {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('academy_manager')) return 'academy_manager';
  if (roles.includes('academy_coach')) return 'academy_coach';
  if (roles.includes('coach')) return 'coach';
  if (isAcademy || roles.includes('academy_user')) return 'trainee';
  return 'runner';
}

/** One row of the chooser's search (GET /api/admin/view-as). */
export interface ViewAsPerson {
  id: string;
  name: string;
  tag: ViewAsTag;
  avatarUrl: string | null;
  /**
   * Their row's own address and group, so the client can stand in for them in
   * the places it keeps "who am I" (lib/view-as-person.ts) — every screen that
   * reads the signed-in email or group off the device reads theirs instead.
   */
  email: string | null;
  groupId: string | null;
  /** The second line: group, and their coach or how many trainees they have. */
  groupName: string | null;
  coachName: string | null;
  trainees: number;
}
