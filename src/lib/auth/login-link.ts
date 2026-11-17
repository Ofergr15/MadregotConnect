/**
 * Direct sign-in links (WhatsApp, the "never got in" email) point at /login.
 * /login has no screen of its own: it forwards to the landing page with the
 * sign-in sheet open, keeping every other query param (e.g. a post-login target).
 */
export const SIGNIN_PARAM = 'signin';

export function loginRedirectTarget(search: string): string {
  const params = new URLSearchParams(search);
  params.set(SIGNIN_PARAM, '1');
  return `/?${params.toString()}`;
}

/** Whether the landing page should open the sign-in sheet; returns the URL without the flag. */
export function consumeSigninFlag(search: string): { open: boolean; rest: string } {
  const params = new URLSearchParams(search);
  const open = params.get(SIGNIN_PARAM) === '1';
  params.delete(SIGNIN_PARAM);
  const qs = params.toString();
  return { open, rest: qs ? `/?${qs}` : '/' };
}
