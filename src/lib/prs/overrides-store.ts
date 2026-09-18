import type { createServerClient } from '@/lib/supabase/server';
import type { PrOverride } from './overrides';

/**
 * Reading the athlete-stated PRs, tolerantly.
 *
 * Migration 104 is applied by hand in the SQL editor like every other one here, so
 * there is a window in which this deploy is live and the table is not. A profile
 * that 500s because an override table is missing would be a strictly worse screen
 * than the one this feature exists to improve, so an absent table reads as "no
 * overrides" and the derived bests show exactly as they do today.
 */

/** Postgres: relation does not exist — migration 104 not pasted in yet. */
export const UNDEFINED_TABLE = '42P01';

interface OverrideRow {
  bucket_key: string;
  seconds: number | null;
  achieved_on: string | null;
  note: string | null;
  hidden: boolean;
}

/**
 * This athlete's stated PRs. `[]` both when they have none and when the table
 * isn't there — the two are the same thing to every caller, which is why this
 * returns a list rather than a "table missing" signal. The WRITE path is where
 * the difference matters, and it checks for itself.
 */
export async function readPrOverrides(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
): Promise<PrOverride[]> {
  const { data, error } = await supabase
    .from('athlete_pr_overrides')
    .select('bucket_key, seconds, achieved_on, note, hidden')
    .eq('athlete_id', athleteId);
  if (error || !data) return [];
  return (data as OverrideRow[]).map((row) => ({
    bucketKey: row.bucket_key,
    seconds: row.seconds,
    achievedOn: row.achieved_on,
    note: row.note,
    hidden: !!row.hidden,
  }));
}
