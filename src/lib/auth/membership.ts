/**
 * "May the person holding this session be inside the app, and if not, why not?"
 *
 * One pure function, because the answer is read in two places that must not drift:
 * /api/auth/me sends it, and the (app) layout blocks on it. It is deliberately NOT
 * derivable from `role` — a runner who was never approved, and a runner whose access
 * was revoked, both keep `role: 'runner'`, which reads as "let them in".
 *
 * Four answers, and the last two are the reason this file exists:
 *
 *   'active'   — a member. The only value that may see club content.
 *   'none'     — a verified session with no athletes row at all (resolved by the
 *                caller, not here: there is no row to pass in).
 *   'pending'  — a row that has never been approved. Somebody who just walked in
 *                and is waiting for the coach. Their screen promises an approval
 *                is coming, and re-checks itself until it lands.
 *   'inactive' — a row that WAS approved and is no longer active. Access was
 *                removed, or they never finished /join. Nothing is coming; the
 *                screen says so instead of promising an approval that will not
 *                arrive.
 *
 * Telling those two apart matters now that a Strava sign-in lands as 'pending'
 * (see the login branch of /api/strava/callback). Before that, the only way to be
 * non-active was to have lost access, so one message covered both. Showing a new
 * runner "your access is not active — an admin can turn it back on" would be the
 * app's first sentence to them, and it would be wrong.
 */
export type Membership = 'active' | 'pending' | 'inactive' | 'none';

/**
 * The values that keep somebody out of the shell. Exported as a list so the layout
 * narrows `me.membership` against it instead of restating the three names inline —
 * that is how a fourth blocking value would get added here and silently let people
 * in there.
 */
export const BLOCKED_MEMBERSHIPS = ['none', 'pending', 'inactive'] as const;
export type BlockedMembership = (typeof BLOCKED_MEMBERSHIPS)[number];

export function membershipFor(row: {
  status?: string | null;
  approved?: boolean | null;
}): Exclude<Membership, 'none'> {
  if (row.status === 'active') return 'active';
  // `approved` is read as "has this account ever been let in", so only an explicit
  // false is pending. An undefined — an older deploy, or a select that could not
  // read the column — falls back to 'inactive', which is the answer that promises
  // nothing.
  return row.approved === false ? 'pending' : 'inactive';
}
