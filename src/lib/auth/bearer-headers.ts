'use client';

import { getSupabase } from '@/lib/supabase/client';
import { trySilentReauth } from '@/lib/auth/silent-reauth';

// Attaches the caller's real Supabase session token as a Bearer header. This is
// now the app's ONLY way of proving who's asking — the x-user-email convention
// it used to sit alongside is gone (no route reads it, nothing sends it), so
// every gated route, athlete or staff, is reached through here.
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
