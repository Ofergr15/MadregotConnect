'use client';

import { getSupabase } from '@/lib/supabase/client';

/** Wipe browser identity so a new Strava/magic-link session can't race with Test Runner. */
export async function clearLocalIdentity() {
  try {
    await getSupabase().auth.signOut({ scope: 'local' });
  } catch {
    // ignore — may not be configured yet on public pages
  }
  if (typeof window === 'undefined') return;
  for (const key of [
    'athlete_id',
    'athlete_name',
    'athlete_email',
    'athlete_group_id',
    'coach_email',
    // These legacy global flags belong to the previous identity.
    'dashboard_synced',
    'dashboard_synced_with_garmin',
  ]) {
    localStorage.removeItem(key);
  }
}
