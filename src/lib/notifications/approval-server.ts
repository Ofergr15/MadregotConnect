// The DB half of lib/notifications/approval.ts: read and write the approvals
// row in app_settings, and decide whether a date is a quality day the same way
// the 07:30 quality push does (lib/quality-session/server.ts), so the two can't
// disagree about which mornings count.

import type { createServerClient } from '@/lib/supabase/server';
import { loadQualityWorkout } from '@/lib/quality-session/server';
import { APPROVAL_KEY, parseApprovals, type ApprovalStore } from './approval';

type Db = ReturnType<typeof createServerClient>;

export async function loadApprovals(supabase: Db): Promise<ApprovalStore> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', APPROVAL_KEY).maybeSingle();
  if (error) throw error;
  return parseApprovals(data?.value);
}

export async function saveApprovals(supabase: Db, store: ApprovalStore): Promise<void> {
  const { error } = await supabase.from('app_settings').upsert(
    { key: APPROVAL_KEY, value: JSON.stringify(store), updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  if (error) throw error;
}

/** The date's quality session (name + type), or null when it is not a quality day. */
export async function qualityOf(supabase: Db, date: string) {
  return loadQualityWorkout(supabase, date);
}
