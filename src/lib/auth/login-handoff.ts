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
  if (!state) return { isLogin: false, challenge: null, linkAthleteId: null };
  if (state === 'login') return { isLogin: true, challenge: null, linkAthleteId: null };
  if (state.startsWith(STATE_PREFIX)) {
    const challenge = state.slice(STATE_PREFIX.length);
    return {
      isLogin: true,
      challenge: /^[A-Za-z0-9_-]{43}$/.test(challenge) ? challenge : null,
      linkAthleteId: null,
    };
  }
  return { isLogin: false, challenge: null, linkAthleteId: state };
}
