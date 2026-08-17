/**
 * Client-side fetch wrapper that attaches the user's Supabase JWT to every
 * request. Used by photo UI components so photo API routes can verify identity.
 *
 * Only used for photo routes — the rest of the app sends unauthenticated requests.
 */

import { getSupabase } from '@/lib/supabase/client';

export async function authedFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const { data: { session } } = await getSupabase().auth.getSession();
  const token = session?.access_token;

  const headers: HeadersInit = {
    ...(init.headers as Record<string, string> | undefined),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  return fetch(url, { ...init, headers });
}
