/**
 * Synthetic QA athletes (migration 182, `athletes.is_test_account`).
 *
 * A test account can write runs, likes, comments etc. without becoming visible to
 * — or notifying — other members. Its own content stays visible to itself and to staff.
 *
 * Fails OPEN: a missing column (migration not pasted yet) or any read error returns
 * an empty set, i.e. exactly today's behaviour.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingColumn } from '@/lib/supabase/schema-drift';

export async function testAccountIds(db: SupabaseClient): Promise<Set<string>> {
  try {
    const { data, error } = await db.from('athletes').select('id, is_test_account').eq('is_test_account', true);
    if (error) {
      if (!isMissingColumn(error, 'is_test_account')) console.error('testAccountIds:', error.message);
      return new Set();
    }
    // Re-checked per row: only an explicit `true` hides anyone.
    return new Set(
      ((data || []) as { id: string; is_test_account?: boolean | null }[])
        .filter((r) => r.is_test_account === true)
        .map((r) => r.id),
    );
  } catch {
    return new Set();
  }
}

export async function isTestAccount(db: SupabaseClient, athleteId: string | null | undefined): Promise<boolean> {
  if (!athleteId) return false;
  return (await testAccountIds(db)).has(athleteId);
}

/**
 * The ids whose content this viewer must not see: every test account minus the
 * viewer themselves; nothing for staff.
 */
export function hiddenTestAccountsFor(
  testIds: Set<string>,
  viewer: { athleteId?: string | null; isStaff?: boolean },
): Set<string> {
  if (viewer.isStaff || testIds.size === 0) return new Set();
  const hidden = new Set(testIds);
  if (viewer.athleteId) hidden.delete(viewer.athleteId);
  return hidden;
}
