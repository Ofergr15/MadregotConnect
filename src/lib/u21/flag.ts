import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveClubScope } from '@/lib/features/flags';
import { enablementRows } from '@/lib/features/server';

/** The club-wide `u21_entry` switch (feature_enablements). Fails closed: no table / any error = off. */
export async function u21EntryOn(db?: SupabaseClient): Promise<boolean> {
  try {
    const rows = await enablementRows('u21_entry', db as never);
    return rows ? resolveClubScope('u21_entry', rows) : false;
  } catch {
    return false;
  }
}
