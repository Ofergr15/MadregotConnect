import { createServerClient } from '@/lib/supabase/server';
import { resolveClubScope } from '@/lib/features/flags';
import { readEnablementRows } from '@/lib/features/server';

/**
 * Whether new sign-ups are taken right now: the club-wide `signups_open` switch
 * (lib/features/flags). Default OFF, and fails closed — a failed read or a missing
 * table keeps the door shut, since "closed" is the owner's standing decision and a
 * DB hiccup must not reopen it. Flip it in feature_enablements; no deploy needed.
 *
 * Only NEW sign-ups. An invite link (/join/{token}) is an existing invitation and
 * never consults this.
 */
export async function signupsOpen(db = createServerClient()): Promise<boolean> {
  try {
    const { rows, failed } = await readEnablementRows(['signups_open'], db);
    if (failed || !rows) return false;
    return resolveClubScope('signups_open', rows);
  } catch {
    return false;
  }
}

/** The body every sign-up POST answers while closed. Same for every address: says nothing about who is a member. */
export const SIGNUPS_CLOSED_BODY = { error: 'signups-closed' } as const;
