import type { SupabaseClient } from '@supabase/supabase-js';
import { isFeatureEnabled } from '@/lib/features/server';
import { painRecipientIds } from '@/lib/feedback/pain-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/**
 * A pain alert held over a staff member's quiet hours (lib/push.ts → `quiet_deferred` row) is
 * re-sent hours later by cron/notifications. By then the feature may be off for that runner,
 * or the recipient may no longer be one of the runner's coaches. So delivery re-checks
 * (2026-11-22) instead of sending a stale copy:
 *   - the source kind (kept in `created_by` as `quiet:<kind>` — no migration) is a pain kind;
 *   - the runner (`actor_athlete_id`) still has feedback_pain;
 *   - the recipient (`audience_id`) is still among painRecipientIds(runner).
 * A row without that context (written before this change) cannot be checked and is not sent.
 */
export const DEFERRED_SOURCE_PREFIX = 'quiet:';
const PAIN_KINDS = new Set(['pain_report', 'pain_no_checkin']);

export interface DeferredRow { created_by?: string | null; actor_athlete_id?: string | null; audience_id?: string | null }

export async function deferredStillEligible(db: Db, n: DeferredRow): Promise<{ ok: boolean; reason?: string }> {
  const kind = typeof n.created_by === 'string' && n.created_by.startsWith(DEFERRED_SOURCE_PREFIX)
    ? n.created_by.slice(DEFERRED_SOURCE_PREFIX.length) : null;
  if (!kind || !PAIN_KINDS.has(kind)) return { ok: false, reason: 'no_source_context' };
  if (!n.actor_athlete_id || !n.audience_id) return { ok: false, reason: 'no_source_context' };
  try {
    if (!(await isFeatureEnabled('feedback_pain', n.actor_athlete_id, db))) return { ok: false, reason: 'feature_off' };
    const { ids } = await painRecipientIds(db, n.actor_athlete_id);
    if (!ids.includes(n.audience_id)) return { ok: false, reason: 'not_a_recipient_now' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'check_failed' };
  }
}
