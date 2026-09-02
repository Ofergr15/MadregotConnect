'use client';

import { getSupabase } from '@/lib/supabase/client';
import { trySilentReauth } from '@/lib/auth/silent-reauth';

// Attaches the signed-in coach/admin's real Supabase session token as a
// Bearer header, for routes gated by requireSession/requireAthlete
// (src/lib/auth-session.ts) — as opposed to the app's more common
// x-user-email convention (src/lib/api.ts's authHeaders).
export async function bearerHeaders(includeJson = true): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession();
  // A missing session is the normal state for an athlete who hasn't touched the
  // feed in a while (see /api/auth/silent-session), so re-mint it rather than
  // sending no credential at all — otherwise every route migrated off
  // x-user-email answers 401 and the screen behind it renders empty. Costs one
  // POST per page load at most, and nothing once it's known to be hopeless.
  const token = data.session?.access_token || (await trySilentReauth());
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
