import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

// The OAuth `state` for "connect Strava to THIS athlete" (link mode).
//
// It used to be the bare athlete id. Strava echoes `state` back untouched and the
// callback wrote the returning Strava account onto whichever row it named, with no
// session to check (the callback is a browser redirect from Strava). Anyone could
// therefore build their own authorize URL with state=<someone's id>, approve their
// own Strava account, and have it written onto that member — and because login mode
// recognises a member by strava_athlete_id, their next "Sign in with Strava" then
// resolved to the victim's row.
//
// Now the state is minted by GET /api/strava only AFTER requireCallerForAthlete has
// verified the caller may act for that athlete, and the callback accepts only a
// state this server signed, for that athlete, in the last 10 minutes.
//
// Signed with ENCRYPTION_KEY under its own label (the action-token approach), so no
// new environment variable is needed; an unusable key fails closed.
//
// Browser binding (OAuth CSRF): GET /api/strava also sets an HttpOnly, Secure,
// SameSite=Lax cookie holding sha256(nonce), scoped to the callback path for the same
// 10 minutes. The callback accepts the state only together with that cookie and
// clears it, so a state captured in transit cannot be completed from another browser,
// and one browser cannot complete it twice. This is NOT a server-side one-use store:
// a browser that kept a copy of the cookie could replay within 10 minutes; a nonce
// table would be needed for that.
//
// Known cost: the cookie is set on the response to the app's fetch of /api/strava and
// must come back on Strava's redirect to the callback. If the authorize page opens in
// a DIFFERENT cookie jar (e.g. an iOS home-screen app handing off to Safari) the
// cookie is missing and the link is refused (bad_state) — fail closed, needs a device check.

const PREFIX = 'link.';
const LABEL = 'strava-link-state-v1';
export const LINK_STATE_MAX_AGE_SECONDS = 10 * 60;

function secret(): string | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) return null;
  return `${key}:${LABEL}`;
}

const mac = (s: string, body: string) => createHmac('sha256', s).update(body).digest('base64url');

/** A signed link state for `athleteId`, or null when the key is unusable. */
export function signLinkState(athleteId: string, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  const s = secret();
  if (!s || !athleteId) return null;
  const body = `${Buffer.from(athleteId, 'utf8').toString('base64url')}.${nowSeconds}.${randomBytes(9).toString('base64url')}`;
  return `${PREFIX}${body}.${mac(s, body)}`;
}

export const LINK_COOKIE = 'mc_strava_link';

/** sha256(nonce) of a link state, for the binding cookie; null if not a link state. */
export function linkBindingOf(state: string | null | undefined): string | null {
  if (!state || !state.startsWith(PREFIX)) return null;
  const parts = state.slice(PREFIX.length).split('.');
  if (parts.length !== 4 || !parts[2]) return null;
  return createHash('sha256').update(parts[2]).digest('base64url');
}

/** The state is valid AND the request carries the cookie bound to it. */
export function verifyBoundLinkState(state: string | null | undefined, cookieValue: string | null | undefined, nowSeconds?: number): string | null {
  const id = verifyLinkState(state, nowSeconds);
  if (!id) return null;
  const want = linkBindingOf(state);
  if (!want || !cookieValue) return null;
  const a = Buffer.from(want); const b = Buffer.from(cookieValue);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export function isLinkState(state: string | null | undefined): boolean {
  return !!state && state.startsWith(PREFIX);
}

/** The athlete id a valid, unexpired state names; null for anything else. */
export function verifyLinkState(state: string | null | undefined, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  const s = secret();
  if (!s || !state || !state.startsWith(PREFIX)) return null;
  const parts = state.slice(PREFIX.length).split('.');
  if (parts.length !== 4) return null;
  const [idPart, issuedPart, nonce, sig] = parts;
  const expected = Buffer.from(mac(s, `${idPart}.${issuedPart}.${nonce}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const issued = Number(issuedPart);
  if (!Number.isInteger(issued) || nowSeconds - issued > LINK_STATE_MAX_AGE_SECONDS || issued - nowSeconds > 60) return null;
  const id = Buffer.from(idPart, 'base64url').toString('utf8');
  return id || null;
}
