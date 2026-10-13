/**
 * The join that ends with NO session (launch report BL1 / N1).
 *
 * `/join/{token}` finishes three ways, and only the Strava one mints a Supabase
 * session (the OAuth callback does it). "אעשה את זה מאוחר יותר" and the Garmin form
 * write the profile through /api/athletes/connect, which is public, and leave the
 * browser holding only `athlete_id` in localStorage. The shell admits that claim,
 * and then every request it makes answers 401 — a 20 s spinner with no tab bar.
 *
 * So the join page remembers its invitation token under JOIN_TOKEN_KEY, and when
 * the shell learns from /api/auth/me that the browser has no live session it
 * sends it to the code sign-in (`/welcome?t=`), which knows the person by that
 * same token (athletes.invite_token) and mints the real session.
 */
export const JOIN_TOKEN_KEY = 'join_token';

const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** Where a session-less browser signs in. The token is carried only when it is well formed. */
export function sessionlessSignInPath(joinToken: string | null | undefined): string {
  const t = (joinToken || '').trim();
  return TOKEN_RE.test(t) ? `/welcome?t=${encodeURIComponent(t)}` : '/welcome';
}

/** True for the fetch error useApi throws on a 401 (lib/api.ts sets `status`). */
export function isUnauthorizedError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { status?: unknown }).status === 401;
}
