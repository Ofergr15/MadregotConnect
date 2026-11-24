import { createHmac, timingSafeEqual } from 'crypto';
import { NATIVE_SCHEME } from '@/lib/data-sources/native';

/**
 * "Sign in with Strava" started by the NATIVE app (ASWebAuthenticationSession).
 *
 * The sheet only closes when the OAuth ends on the app's own scheme, so the callback
 * must finish on `madregot://…` instead of the web `/auth/resolve` page. Three rules:
 *
 *  1. The native marker lives INSIDE the OAuth `state` that GET /api/strava minted,
 *     HMAC-signed with ENCRYPTION_KEY under its own label and valid for 10 minutes.
 *     No redirect target is ever read from a query param: a hand-built or tampered
 *     state fails verification and the callback treats it as a web flow.
 *  2. The target is FIXED — `NATIVE_LOGIN_RETURN` — never a caller-supplied URL.
 *  3. No session or refresh token goes into the custom-scheme URL (any app can
 *     register `madregot://`). The native state REQUIRES a PKCE-style challenge;
 *     the callback parks the login in `login_handoffs` exactly as for the PWA, and
 *     the app exchanges its verifier at POST /api/auth/claim-login (single use,
 *     10-minute TTL). The madregot:// URL carries only a status and a debug id.
 */
export const NATIVE_LOGIN_RETURN = `${NATIVE_SCHEME}://auth/strava`;

const PREFIX = 'nlogin.';
const LABEL = 'strava-native-login-state-v1';
export const NATIVE_LOGIN_STATE_MAX_AGE_SECONDS = 10 * 60;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

function secret(): string | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) return null;
  return `${key}:${LABEL}`;
}

const mac = (s: string, body: string) => createHmac('sha256', s).update(body).digest('base64url');

/** Signed native-login state for `challenge`, or null (bad challenge / unusable key). */
export function signNativeLoginState(challenge: string, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  const s = secret();
  if (!s || !CHALLENGE_RE.test(challenge)) return null;
  const body = `${challenge}.${nowSeconds}`;
  return `${PREFIX}${body}.${mac(s, body)}`;
}

/** The challenge of a state this server signed in the last 10 minutes, else null. */
export function verifyNativeLoginState(state: string | null, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  if (!state || !state.startsWith(PREFIX)) return null;
  const s = secret();
  if (!s) return null;
  const parts = state.slice(PREFIX.length).split('.');
  if (parts.length !== 3) return null;
  const [challenge, ts, sig] = parts;
  if (!CHALLENGE_RE.test(challenge) || !/^\d{1,12}$/.test(ts)) return null;
  const expected = Buffer.from(mac(s, `${challenge}.${ts}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const age = nowSeconds - Number(ts);
  if (age < 0 || age > NATIVE_LOGIN_STATE_MAX_AGE_SECONDS) return null;
  return challenge;
}

/** The fixed app URL the callback ends on. Only a status word and a debug id. */
export function nativeLoginReturn(result: 'ok' | 'denied' | 'error', debugId: string): string {
  return `${NATIVE_LOGIN_RETURN}?result=${result}&debug=${encodeURIComponent(debugId)}`;
}
