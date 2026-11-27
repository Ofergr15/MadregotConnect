// Admin login policy (task 77). Pure, so the route and tests share it.

/** Roles the admin login admits. Narrower than STAFF_ROLES on purpose: academy coaches use the academy. */
export const ADMIN_LOGIN_ROLES = ['admin', 'coach'];

/**
 * The legacy shared-password path. OFF unless ADMIN_PASSWORD_LOGIN=on — one password for
 * every staff email meant anyone who learned it could become any staff member. Kept as a
 * temporary fallback for the owner to switch back on if the JWT path locks someone out.
 */
export function passwordLoginEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ADMIN_PASSWORD_LOGIN === 'on' && !!env.ADMIN_PASSWORD;
}
