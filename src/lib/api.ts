'use client';

import useSWR, { SWRConfiguration } from 'swr';
import { bearerHeaders } from '@/lib/auth/bearer-headers';

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

// Doing this here means every useApi() GET in the app authenticates properly
// without touching each caller.
export async function apiFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: await bearerHeaders(false),
  });
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
