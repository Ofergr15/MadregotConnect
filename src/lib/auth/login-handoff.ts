/**
 * Handing a Strava login back to the app that started it.
 *
 * A standalone PWA is not allowed to navigate away from its own origin. When it
 * tries, iOS opens the page in an in-app browser sheet on top of the app — the
 * one with the ✕ and the Safari compass. That sheet gets its own storage
 * partition, so the Supabase session the OAuth callback establishes there is
 * invisible to the app underneath: the member logs in, closes the sheet, and the
 * app still shows the marketing page. Every launch, forever.
 *
 * The sheet and the app share exactly one thing: our server. So the callback
 * leaves the login in a `login_handoffs` row and the app collects it the moment
 * it comes back to the foreground.
 *
 * The row is keyed by a PKCE-style challenge, which is what makes it safe to
 * leave lying around:
 *
 *   verifier   32 random bytes, generated in the app, never leaves its storage
 *   challenge  base64url(SHA-256(verifier)), travels in the OAuth `state`
 *
 * The challenge is public — it goes through Strava's servers and shows up in
 * request logs — and knowing it buys nothing, because claiming the row requires
 * presenting a verifier that hashes to it. Only the app that started the login
 * has that. The row is single-use and short-lived on top.
 *
 * Web Crypto rather than node:crypto on purpose: this module is imported by both
 * the browser and the route handlers, and `crypto.subtle` is present in both.
 */

/** localStorage key holding the pending verifier, in the app's own partition. */
export const HANDOFF_STORAGE_KEY = 'mc_login_handoff';

/**
 * How long a login may sit unclaimed. Long enough to authorise Strava on a slow
 * phone — including a password prompt and a two-factor code — and short enough
 * that an abandoned login is not still claimable when the phone is handed over.
 */
export const HANDOFF_TTL_MS = 10 * 60 * 1000;

const STATE_PREFIX = 'login:';

/**
 * "Finish an invited member's registration with Strava."
 *
 * What follows the prefix is the athlete's own INVITE TOKEN, and it must not be
 * anything else — least of all an athlete id.
 *
 * The callback trusts `state` completely: it decides whose row the returning
 * Strava tokens are written onto, and for this branch it also mints a session for
 * that row. But `state` is not ours by the time it comes back — anyone can build
 * a Strava authorize URL by hand, because `client_id` is public and the
 * `redirect_uri` is simply ours. So `state=join:<athlete-uuid>` would be a
 * one-request account takeover: name a victim's id, authorise with your own
 * Strava, and the callback hands you their session. Gating /api/strava does not
 * prevent that; nothing forces an attacker through our route.
 *
 * The invite token is safe in that position for the one reason that matters: it
 * is 16 random bytes (`randomBytes(16)` in the approve route), so it cannot be
 * guessed for a chosen victim. It is already the credential for this member's
 * whole registration — /api/join/groups and /api/athletes/connect both accept it
 * alone — so this grants no caller anything they did not already have.
 *
 * Trade-off worth knowing: the token now travels through Strava's servers and
 * will sit in their request logs. It is already emailed in plaintext and sits in
 * the browser's URL bar for the whole join, so this widens the exposure by a
 * third party rather than by a class. Keep it out of anything longer-lived, and
 * do not reuse this prefix for a state that is not one-member-scoped.
 */
const JOIN_PREFIX = 'join:';

/** The OAuth `state` for the Strava step of /join/{token}. */
export function joinState(inviteToken: string): string {
  return `${JOIN_PREFIX}${inviteToken}`;
}

/**
 * The pending verifier, in the app's own storage partition.
 *
 * Browser-only, and guarded on `localStorage` itself rather than on `window`:
 * this module is imported by route handlers too, and the guard should name the
 * API that is actually missing there.
 */
export function storePendingVerifier(verifier: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify({ verifier, at: Date.now() }));
  } catch {
    // Private mode / quota. The login still works, it just won't hand back.
  }
}

/** The pending verifier, or null if there is none or it has gone stale. */
export function readPendingVerifier(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    const { verifier, at } = JSON.parse(raw) as { verifier?: string; at?: number };
    // Expire on the client as well as the server, so an abandoned login stops
    // costing a request on every single foreground for the rest of time.
    if (!verifier || !at || Date.now() - at > HANDOFF_TTL_MS) {
      localStorage.removeItem(HANDOFF_STORAGE_KEY);
      return null;
    }
    return verifier;
  } catch {
    return null;
  }
}

export function clearPendingVerifier(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(HANDOFF_STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh verifier. Store it, hand `challengeFor` its value, never send it. */
export function newVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** base64url(SHA-256(verifier)) — the public half. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * The OAuth `state` for a login that wants its session handed back.
 *
 * Plain `login` (no challenge) still means "log in and set the session right
 * here", which is correct for a normal browser tab and is what every existing
 * link does.
 */
export function loginState(challenge: string | null | undefined): string {
  return challenge ? `${STATE_PREFIX}${challenge}` : 'login';
}

export interface ParsedState {
  /** A login, with or without a handoff. */
  isLogin: boolean;
  /** The challenge to hand the session back through, if this login asked for one. */
  challenge: string | null;
  /** The athlete id, when this is the coach's "link Strava to <athlete>" flow. */
  linkAthleteId: string | null;
  /** The invite token, when this is the Strava step of /join/{token}. */
  joinToken: string | null;
}

/**
 * Read the `state` Strava echoes back.
 *
 * Guarded rather than trusting: the challenge is used as a primary key and comes
 * from a query string, so anything that isn't the 43-char base64url of a SHA-256
 * digest is treated as no challenge at all — which degrades to the old
 * set-the-session-here behaviour instead of failing the login.
 */
export function parseLoginState(state: string | null): ParsedState {
  const none = { isLogin: false, challenge: null, linkAthleteId: null, joinToken: null };
  if (!state) return none;
  if (state === 'login') return { ...none, isLogin: true };
  if (state.startsWith(STATE_PREFIX)) {
    const challenge = state.slice(STATE_PREFIX.length);
    return {
      ...none,
      isLogin: true,
      challenge: /^[A-Za-z0-9_-]{43}$/.test(challenge) ? challenge : null,
    };
  }
  if (state.startsWith(JOIN_PREFIX)) {
    // Shape-checked like the challenge above, and for the same reason: this is
    // about to be used as a lookup key straight off a query string. Invite tokens
    // are `randomBytes(16).toString('hex')` — exactly 32 lowercase hex chars.
    // Anything else is not a token we minted, so it resolves to no join at all
    // rather than reaching the database.
    const token = state.slice(JOIN_PREFIX.length);
    return { ...none, joinToken: /^[0-9a-f]{32}$/.test(token) ? token : null };
  }
  return { ...none, linkAthleteId: state };
}
