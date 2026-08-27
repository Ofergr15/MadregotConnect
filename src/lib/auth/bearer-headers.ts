'use client';

import { getSupabase } from '@/lib/supabase/client';

// Attaches the signed-in coach/admin's real Supabase session token as a
// Bearer header, for routes gated by requireSession/requireAthlete
// (src/lib/auth-session.ts) — as opposed to the app's more common
// x-user-email convention (src/lib/api.ts's authHeaders).
export async function bearerHeaders(includeJson = true): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
