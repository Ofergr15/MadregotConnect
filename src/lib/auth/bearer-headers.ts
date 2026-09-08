'use client';

import { getSupabase } from '@/lib/supabase/client';
import { trySilentReauth } from '@/lib/auth/silent-reauth';

// Attaches the caller's real Supabase session token as a Bearer header. This is
// now the app's ONLY way of proving who's asking — the x-user-email convention
// it used to sit alongside is gone (no route reads it, nothing sends it), so
// every gated route, athlete or staff, is reached through here.

// ── Why the token is cached ───────────────────────────────────────────────────
//
// Every single request the app makes goes through here, and this used to await
// `getSession()` each time. That is not a cheap read: auth-js takes a lock around
// it (Web Locks where available), so N requests firing together do not overlap —
// they queue, one after another, behind each other AND behind auto-refresh's own
// timer. A dashboard that opens eight SWR keys therefore paid eight serialised
// lock acquisitions before the first byte of the first request left the browser,
// which is the part of the cold open that no amount of server work can fix.
//
// So hold the access token in module scope and hand it straight back. Two things
// keep it honest:
//   • onAuthStateChange REPLACES it — that is the same event auto-refresh fires
//     when it mints a new token, so the cache follows the refresh rather than
//     racing it, and SIGNED_OUT empties it.
//   • It is only trusted while more than a minute of its life remains. Inside
//     that last minute every call falls through to `getSession()` exactly as
//     before, which is also what asks auth-js to refresh.
//
// A token can still be dead before it expires — Supabase can revoke the session it
// names (see recoverFrom401 in lib/api.ts). That was already true of
// `getSession()`, which happily keeps handing the corpse out, and the recovery
// path is unchanged; it calls invalidateBearerToken() so the corpse isn't served
// again from here while it works.
let cached: { token: string; expiresAtMs: number } | null = null;

/** Stop trusting the cache this long before the token actually expires. */
const EXPIRY_MARGIN_MS = 60_000;

let subscribed = false;
function trackSessionChanges(): void {
  if (subscribed) return;
  subscribed = true;
  try {
    getSupabase().auth.onAuthStateChange((_event, session) => {
      cached =
        session?.access_token && session.expires_at
          ? { token: session.access_token, expiresAtMs: session.expires_at * 1000 }
          : null;
    });
  } catch {
    // Supabase isn't configured in this environment. Nothing to track, and
    // throwing here would break callers that only wanted headers.
  }
}

/** Drop the cached token — for a 401 on a request that DID carry one. */
export function invalidateBearerToken(): void {
  cached = null;
}

/**
 * The token to send, from cache when it's safely live and from auth-js otherwise.
 */
async function accessToken(): Promise<string | null> {
  trackSessionChanges();
  if (cached && cached.expiresAtMs - Date.now() > EXPIRY_MARGIN_MS) return cached.token;

  const { data } = await getSupabase().auth.getSession();
  if (data.session?.access_token && data.session.expires_at) {
    cached = {
      token: data.session.access_token,
      expiresAtMs: data.session.expires_at * 1000,
    };
    return cached.token;
  }
  // A missing session is the normal state for an athlete who hasn't touched the
  // feed in a while (see /api/auth/silent-session), so re-mint it rather than
  // sending no credential at all — otherwise every route migrated off
  // x-user-email answers 401 and the screen behind it renders empty. Costs one
  // POST per page load at most, and nothing once it's known to be hopeless.
  // (setSession() inside there fires onAuthStateChange, which fills the cache.)
  return data.session?.access_token || (await trySilentReauth());
}

export async function bearerHeaders(includeJson = true): Promise<Record<string, string>> {
  const token = await accessToken();
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
