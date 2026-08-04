'use client';

import useSWR, { SWRConfiguration } from 'swr';

// The app's auth convention: every scoped endpoint reads x-user-email, resolved
// from the coach/athlete email stored in localStorage. The SWR fetcher below
// applies it uniformly so callers just pass a URL.
export function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const email = localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
  return email ? { 'x-user-email': email } : {};
}

export async function apiFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
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
