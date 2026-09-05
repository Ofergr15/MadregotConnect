'use client';

import useSWR, { SWRConfiguration } from 'swr';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { trySilentReauth } from '@/lib/auth/silent-reauth';
import { getSupabase } from '@/lib/supabase/client';

// The app's OLD auth convention was an `x-user-email` header, read from the
// coach/athlete email in localStorage. It was forgeable — just a string the
// client picks — and it's gone from both sides now: no route reads it (see
// resolveVerifiedCaller in src/lib/auth/self-or-staff.ts) and nothing here sends
// it. Everything below carries the verified Supabase session instead.

/**
 * Headers for a hand-written fetch: the verified bearer token, same as the SWR
 * fetcher. Pass `true` when there's a JSON body.
 *
 * Pass `false` (the default) for GET/DELETE and for FormData — fetch has to set
 * the multipart boundary itself.
 */
export async function apiHeaders(includeJson = false): Promise<Record<string, string>> {
  return bearerHeaders(includeJson);
}

/**
 * Recovers from a 401 on a request that DID carry a token.
 *
 * ⚠️ The failure this exists for. `bearerHeaders()` re-mints a session only when
 * there is no session at all — but a token can be present, well-formed, correctly
 * signed and unexpired and STILL be dead, because Supabase revoked the session it
 * names. (Until 2026-09-05 the app did that to itself on every login: see
 * lib/auth/synthetic-session.ts.) In that state `getSession()` keeps handing the
 * corpse out, `autoRefreshToken` can't refresh it either, and every gated route
 * 401s — so the whole app rendered a "try again" button whose only possible
 * outcome was the same 401. Clearing site data was the only escape.
 *
 * So: re-mint once. If the browser can't prove it ever logged in, clear the dead
 * session so the app falls through to its login screen — a wrong screen the user
 * can act on beats a right screen that can't load.
 *
 * `scope: 'local'` is deliberate: the default 'global' asks Supabase to revoke
 * server-side sessions, which for an already-orphaned token means a pointless
 * failing round trip, and on a shared account would sign out the user's other
 * devices — the exact harm this whole change is undoing.
 */
async function recoverFrom401(): Promise<string | null> {
  const token = await trySilentReauth();
  if (token) return token;
  try {
    await getSupabase().auth.signOut({ scope: 'local' });
  } catch {
    // Nothing to do about it, and throwing here would replace a 401 the caller
    // knows how to render with an exception it doesn't.
  }
  return null;
}

// Doing this here means every useApi() GET in the app authenticates properly
// without touching each caller.
export async function apiFetcher<T = unknown>(url: string): Promise<T> {
  const headers = await bearerHeaders(false);
  let res = await fetch(url, { headers });

  // Only when we actually sent a credential. A 401 with no Authorization header
  // is just an unauthenticated caller, and bearerHeaders has already tried to
  // fix that; retrying would only repeat its work.
  if (res.status === 401 && headers.Authorization) {
    const fresh = await recoverFrom401();
    // Exactly one retry. The recovery either produced a live token or cleared the
    // dead one, and neither outcome gets better by going round again.
    if (fresh) res = await fetch(url, { headers: { ...headers, Authorization: `Bearer ${fresh}` } });
  }

  if (!res.ok) {
    const err = new Error(`Request failed: ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// The native-feel defaults: show cached data instantly, keep it on the screen
// while revalidating in the background, refresh when the app regains focus or
// reconnects, and dedupe bursts. Individual hooks can override.
export const SWR_DEFAULTS: SWRConfiguration = {
  fetcher: apiFetcher,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  keepPreviousData: true,
  dedupingInterval: 4000,
  errorRetryCount: 2,
};

// Thin typed wrapper so screens replace their useEffect+fetch+useState triads
// with one line. `key` null → skip (e.g. before athleteId is known). Returns the
// familiar { data, error, isLoading, mutate }, plus `isStale` (showing cached
// data while a refresh is in flight) for skeleton/opacity decisions in Phase 2.
export function useApi<T = unknown>(key: string | null, config?: SWRConfiguration) {
  const swr = useSWR<T>(key, apiFetcher, config);
  return {
    data: swr.data,
    error: swr.error,
    isLoading: swr.isLoading,
    isStale: swr.isValidating && swr.data !== undefined,
    mutate: swr.mutate,
  };
}
