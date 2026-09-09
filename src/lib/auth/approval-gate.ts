/**
 * "Is this a route an unapproved account may still call?"
 *
 * Approval was UI-only until now. The layout redirected a `pending` membership to
 * /pending-approval in a `useEffect` that its own comment admits fails open, and no
 * server gate read `athletes.approved` at all — so a Strava sign-in from a stranger
 * (which mints a real session and an `approved: false` row, see the no-match branch
 * of /api/strava/callback) could read the club feed, the training plan, the
 * leaderboards and the roster with a plain fetch. The redirect was a suggestion.
 *
 * The gate now lives in `requireSession`, which every authenticated route funnels
 * through, and this is its one exception list. Kept as a pure predicate over the
 * pathname rather than as a flag each route opts into: a new route must be closed by
 * default, because the failure mode of the old design was exactly that nobody
 * remembered to opt in.
 */

/**
 * Prefixes an unapproved-but-signed-in caller may still reach.
 *
 * Every entry is here because the "you are waiting for approval" experience itself
 * depends on it. Nothing that serves club content belongs in this list.
 */
export const APPROVAL_EXEMPT_PREFIXES = [
  // How the client LEARNS it is pending. Blocking this would leave the app with no
  // way to tell the difference between "not approved" and "signed out", which is
  // how somebody ends up staring at a spinner instead of the waiting screen.
  '/api/auth/',
  // The maintenance overlay resolves through requireSession too, and a window is
  // not an approval decision.
  '/api/maintenance',
  // Sign-up and joining, all of which happen BEFORE anybody could be approved.
  '/api/public/',
  '/api/join',
  '/api/invite',
  '/api/claim',
  '/api/athletes/update-group',
  // The one thing the waiting screen offers: "notify me when I'm let in".
  '/api/push/subscribe',
] as const;

/**
 * Does this path require an approved membership?
 *
 * Prefix match on the pathname only — never on the query string, so
 * `/api/feed?x=/api/auth/` cannot buy its way past the list.
 */
export function requiresApproval(pathname: string): boolean {
  const path = (pathname || '').toLowerCase();
  return !APPROVAL_EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

/**
 * Which non-active accounts the SERVER turns away.
 *
 * Not simply "every membership the layout blocks". The layout is a screen and can
 * afford to be strict; this is a 403 on all 174 routes, and getting it wrong locks
 * real members out of an app they are already using. So it turns away exactly the
 * two cases that are genuinely not allowed in:
 *
 *   'pending'  — `approved === false`. The hole this gate exists for: a stranger's
 *                Strava sign-in mints a real session and an unapproved row.
 *   'inactive' AND `status === 'inactive'` — access was deliberately revoked.
 *
 * What that deliberately leaves alone is a row that is neither approved-false nor
 * revoked — an 'invited' row mid-onboarding, or any status this app has not seen.
 * `membershipFor` calls those 'inactive' because an absent `approved` promises
 * nothing, which is the right thing to SAY on a waiting screen and the wrong thing
 * to enforce: 2 of the club's 23 rows are 'invited' right now, they predate any
 * approval flow, and blocking them would buy no security at all.
 */
export function blockedFromApp(user: {
  membership: string;
  athleteStatus: string | null;
}): 'pending-approval' | 'account-inactive' | null {
  if (user.membership === 'pending') return 'pending-approval';
  if (user.athleteStatus === 'inactive') return 'account-inactive';
  return null;
}

/** The pathname of a Request, or '' if it is not a URL this can read. */
export function pathnameOf(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    // A relative or malformed URL means the gate cannot tell which route this is,
    // and the safe answer for a gate is "not exempt" — which '' produces.
    return '';
  }
}
