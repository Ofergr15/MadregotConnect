// An account's roles, plural (migration 127).
//
// `athletes.role` is one value, so nobody could be a club coach AND an academy
// coach, and "academy manager" only existed as a synonym for `admin`. The row now
// carries `extra_roles` beside it. `role` stays the PRIMARY one — the highest of
// the roles the account holds, which is what every single-role reader in the app
// keeps seeing — and the rest ride in `extra_roles`.
//
// Pure: imported by the session resolver, the API routes and the browser alike.

/** Roles the admin screen can switch on. `runner` is not here: every account is one. */
export const GRANTABLE_ROLES = ['coach', 'academy_coach', 'academy_manager', 'admin'] as const;
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

/** One row of the admin "תפקידים" screen (GET /api/admin/roles). */
export interface RolePerson {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  roles: GrantableRole[];
  /** "רץ אקדמיה": `athletes.is_academy`, the academy membership flag. */
  academy?: boolean;
  /** "אינסטגרם": `athletes.is_story_editor` (migration 129), the quality session. */
  storyEditor?: boolean;
  /** When the "קיבלת תפקיד חדש" push last went to them; null when it never did. */
  lastNotifiedAt?: string | null;
}

/** Every role that makes an account staff — the three single-role ones plus the manager. */
export const STAFF_HOLDING_ROLES = ['admin', 'coach', 'academy_coach', 'academy_manager'];

/** Non-staff primary roles, kept as they are when the admin screen saves. */
const MEMBER_ROLES = ['runner', 'core_runner', 'academy_user', 'viewer'];

/**
 * The roles a row holds, primary first, deduplicated. `extra` is whatever the
 * column held — anything that isn't a string array (a database without migration
 * 127, a null) reads as none, which is exactly the account as it was before.
 */
export function heldRoles(role: string | null | undefined, extra: unknown): string[] {
  const out = [role || 'runner'];
  if (Array.isArray(extra)) {
    for (const r of extra) if (typeof r === 'string' && r && !out.includes(r)) out.push(r);
  }
  return out;
}

/** Does this caller hold `role`, as its primary role or an extra one? */
export function hasRole(
  caller: { role?: string | null; roles?: string[] | null } | null | undefined,
  role: string,
): boolean {
  if (!caller) return false;
  return caller.role === role || !!caller.roles?.includes(role);
}

export function holdsStaffRole(roles: string[]): boolean {
  return roles.some(r => STAFF_HOLDING_ROLES.includes(r));
}

/**
 * The grantable roles switched on for a row, as the admin screen shows them.
 * `core_runner` et al. are not grantable here and simply do not appear.
 */
export function grantedRoles(role: string | null | undefined, extra: unknown): GrantableRole[] {
  const held = heldRoles(role, extra);
  return GRANTABLE_ROLES.filter(r => held.includes(r));
}

/**
 * The toggles → what to write. The highest role becomes `role` (admin, then club
 * coach, then academy coach), so the code that reads one role sees the right one;
 * the others go to `extra_roles`. `academy_manager` is never primary — the role
 * enum has no such value — so a manager who is nothing else keeps their member
 * role. With no staff role at all the member role is kept too, and a staff
 * primary role that was switched off falls back to plain `runner`.
 */
export function rolesToColumns(
  granted: readonly GrantableRole[],
  currentRole: string | null | undefined,
): { role: string; extra_roles: GrantableRole[] } {
  const set = new Set(granted.filter(r => (GRANTABLE_ROLES as readonly string[]).includes(r)));
  const primary = (['admin', 'coach', 'academy_coach'] as const).find(r => set.has(r));
  const base = currentRole && MEMBER_ROLES.includes(currentRole) ? currentRole : 'runner';
  const role = primary || base;
  return { role, extra_roles: GRANTABLE_ROLES.filter(r => set.has(r) && r !== role) };
}
