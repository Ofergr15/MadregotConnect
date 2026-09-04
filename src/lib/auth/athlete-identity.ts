/**
 * Which club member a Strava login belongs to.
 *
 * Strava's token response carries no email address — only a numeric athlete id
 * and a display name — so `strava_<id>@strava.madregot.local` is a synthetic
 * address the app invents purely to have something to hang a Supabase auth user
 * on. Nothing else in the club roster uses it: real members are rows keyed on
 * their real email.
 *
 * That mismatch is what produced four duplicate athlete rows in production
 * (Ofer, Tal, Shahar, Sahar — three of them admins). Two separate defects fed
 * it, and this module exists so both are fixed in one place instead of three:
 *
 *   1. The OAuth callback recognised a returning athlete ONLY by
 *      `strava_athlete_id`, a column that is written *by* a Strava login. On a
 *      member's first Strava login it is therefore always NULL, no row matches,
 *      and the callback inserts a second row for somebody who is already in the
 *      club — with no group, `role: 'runner'`, and none of their history.
 *   2. /api/auth/resolve-role then decided who you are by looking `athletes` up
 *      on the session's email, i.e. on the synthetic address. So even when the
 *      callback DID find the right row, the resolve step threw that away and
 *      resolved to whichever row happened to own the synthetic address.
 *
 * The fix is to treat the Strava athlete id as the identity and the email as one
 * of several ways to reach it: `stravaIdFromAuthEmail` recovers the id from the
 * synthetic address (so it survives a lost session, a stale user_metadata blob,
 * or a device cookie that only stored an email), and `pickAthleteRow` chooses
 * between candidate rows deterministically rather than taking "the oldest" or
 * "the first" — both of which picked the duplicate about half the time.
 */

/** Emails minted by stravaAuthEmail() in @/lib/strava/client. */
const STRAVA_AUTH_EMAIL = /^strava_(\d+)@strava\.madregot\.local$/i;

/**
 * The Strava athlete id encoded in a synthetic auth email, or null for a real
 * address. Lets any route that holds only an email — resolve-role, the device
 * cookie behind silent-session — recover the identity without a round trip.
 */
export function stravaIdFromAuthEmail(email?: string | null): number | null {
  const match = STRAVA_AUTH_EMAIL.exec((email || '').trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** True for an address the app invented, false for a member's own email. */
export function isSyntheticAuthEmail(email?: string | null): boolean {
  return stravaIdFromAuthEmail(email) !== null;
}

/**
 * Names as written by two different sources have to compare equal: Strava sends
 * "Tal Borenstein" from the profile, the roster row was typed by the coach. Case,
 * surrounding and repeated whitespace, and Unicode composition (Hebrew vowel
 * marks arrive both composed and decomposed) are all noise here.
 */
export function normalizeAthleteName(name?: string | null): string {
  return (name || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export type IdentityRow = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  status?: string | null;
  created_at?: string | null;
  strava_athlete_id?: number | null;
  strava_auth?: unknown;
  garmin_auth?: unknown;
};

// Mirrors STAFF_ROLES in @/lib/impersonation, which can't be imported here —
// it's a 'use client' module. Only used as a tie-breaker, so drifting by a role
// costs a preference, not a wrong identity.
const STAFF = new Set(['admin', 'coach', 'academy_coach']);

/**
 * Ranked highest-first, compared field by field. Every criterion is a fact about
 * the row rather than an accident of insertion order, which is the point: the
 * code this replaces sorted by `created_at` and took one end or the other, and
 * "oldest" is only the real row until the day someone's duplicate predates their
 * roster entry.
 */
function rank(row: IdentityRow, stravaId?: number | null): number[] {
  const isStravaMatch = !!stravaId && Number(row.strava_athlete_id) === Number(stravaId);
  return [
    // The Strava athlete id is the identity. A row carrying it IS this person.
    isStravaMatch ? 1 : 0,
    // A row with connected credentials is the one their activities flow into.
    (row.strava_auth ? 2 : 0) + (row.garmin_auth ? 1 : 0),
    // A member's own address over an address the app invented for itself: the
    // synthetic row is by construction the newer, emptier one.
    isSyntheticAuthEmail(row.email) ? 0 : 1,
    // Never sign a coach in as a runner. Their duplicate always says 'runner',
    // so this is the difference between staff tools and no staff tools.
    STAFF.has(row.role || '') ? 1 : 0,
    row.status === 'active' ? 1 : 0,
    // Last resort only: the club row predates the duplicate it caused.
    -new Date(row.created_at || 0).getTime(),
  ];
}

/**
 * The athlete row a login belongs to, out of every candidate that matched on
 * Strava id, email, or name. Returns null for an empty set — a genuinely new
 * person, who the caller may then create.
 */
export function pickAthleteRow<T extends IdentityRow>(
  rows: T[],
  stravaId?: number | null,
): T | null {
  let best: T | null = null;
  let bestRank: number[] = [];
  for (const row of rows) {
    const r = rank(row, stravaId);
    if (!best || compare(r, bestRank) > 0) {
      best = row;
      bestRank = r;
    }
  }
  return best;
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * The one active roster row whose name matches, or null if none or more than one
 * does. Deliberately strict — an exact normalised full name and a UNIQUE match —
 * because this is the bridge used when a member logs in with Strava for the
 * first time and nothing else links their Strava account to the club. Matching
 * loosely (first name, or a prefix) would eventually hand one member's account,
 * history and staff role to another, which is worse than the duplicate row it
 * would be trying to avoid.
 */
export function matchAthleteByName<T extends IdentityRow>(rows: T[], name?: string | null): T | null {
  const target = normalizeAthleteName(name);
  if (!target) return null;
  const matches = rows.filter(
    r => r.status === 'active' && normalizeAthleteName(r.name) === target,
  );
  return matches.length === 1 ? matches[0] : null;
}
