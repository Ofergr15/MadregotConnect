'use client';

import { getSupabase } from '@/lib/supabase/client';
import { clearIdentityKeys } from '@/lib/auth/identity-keys';

/** Wipe browser identity so a new Strava/magic-link session can't race with Test Runner. */
export async function clearLocalIdentity() {
  try {
    await getSupabase().auth.signOut({ scope: 'local' });
  } catch {
    // ignore — may not be configured yet on public pages
  }
  clearIdentityKeys();
}
