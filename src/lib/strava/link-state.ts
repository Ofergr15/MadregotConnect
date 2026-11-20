import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

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
// Not one-use: a state replayed within its 10 minutes re-links the SAME athlete the
// legitimate caller already chose, to whatever Strava account completes the flow.
// Making it single-use needs a store (a nonce table); left for review.

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
