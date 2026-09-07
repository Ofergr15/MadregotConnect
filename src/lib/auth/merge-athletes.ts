import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fold a duplicate athlete row into the real one, at runtime.
 *
 * The work is all in SQL — `merge_athlete_rows` (migration 097), which is
 * migration 080's hand-run repair turned into a function. It has to be SQL: it
 * moves every row in the database that points at the duplicate, discovering the
 * tables from the foreign-key catalog, and sets aside anything that collides with
 * a key the real row already satisfies. A TypeScript version would need a
 * hand-written table list, and a table missing from that list is silently emptied
 * by ON DELETE CASCADE when the duplicate goes.
 *
 * WHY THIS IS CALLABLE FROM A LOGIN AT ALL. The club has produced six duplicate
 * rows so far, and each one was repaired by writing SQL and pasting it into the
 * Supabase editor by hand — days after the member was already using the wrong
 * account. The moment the two rows are both in hand is the moment the member logs
 * in, so that is where the merge belongs. The safety is in the function, not in
 * the caller: it refuses to merge away any row that is keyed on a real email
 * address unless a human explicitly overrides that, so the worst a login handler
 * can do is delete a shell row the app itself invented.
 *
 * Best-effort by design. Every caller is on a request that has already succeeded
 * — the member is signed in either way, and being signed into the right account a
 * minute later is much better than a sign-in that fails.
 */
export async function mergeAthleteRows(
  admin: SupabaseClient,
  input: {
    duplicateId: string;
    realId: string;
    /** 'strava-login-reconcile' | 'admin-link' | … — recorded in athlete_merge_log. */
    reason: string;
    /**
     * Only an admin acting deliberately may merge away a row with a real email
     * address. Defaults to false so no automatic caller can pass it by accident.
     */
    allowRealEmailDuplicate?: boolean;
  },
): Promise<{ merged: boolean; error?: string }> {
  if (!input.duplicateId || !input.realId || input.duplicateId === input.realId) {
    return { merged: false, error: 'two different athlete ids are required' };
  }
  try {
    const { data, error } = await admin.rpc('merge_athlete_rows', {
      p_dup: input.duplicateId,
      p_real: input.realId,
      p_reason: input.reason,
      p_require_synthetic_dup: !input.allowRealEmailDuplicate,
    });
    if (error) {
      // 42883 = the function does not exist, i.e. migration 097 has not been
      // applied to this environment yet. Worth its own line in the log: the
      // reconcile silently doing nothing looks exactly like there being nothing
      // to reconcile.
      if (error.code === '42883') {
        console.error('merge_athlete_rows is missing — apply migration 097 to this database.');
      } else {
        console.error('merge_athlete_rows failed:', error);
      }
      return { merged: false, error: error.message };
    }
    // jsonb: {merged:true, moved, discarded, …} or {skipped:'no_duplicate'} when
    // another request got there first.
    const merged = !!(data as { merged?: boolean } | null)?.merged;
    if (merged) console.info('merge_athlete_rows:', data);
    return { merged };
  } catch (err: any) {
    console.error('merge_athlete_rows threw:', err);
    return { merged: false, error: String(err?.message || err) };
  }
}
