import type { SupabaseClient } from '@supabase/supabase-js';
import { MONDAY_WEEK, weekStartDayOf, type WeekStartDay } from '@/lib/utils';

/**
 * Which day this athlete's OWN week starts on — `athletes.week_start_day`
 * (migration 119), 0 = Sunday or 1 = Monday.
 *
 * Read off the athlete whose numbers are being drawn, NOT off the caller: a
 * profile shows one set of figures to everybody who opens it, so the member who
 * reads Sunday–Saturday sees their week cut that way and so does their coach
 * looking at the same page. The alternative — cutting by the viewer — means two
 * people discussing the same screen are reading different totals, which is the bug
 * this whole preference exists to avoid rather than a feature.
 *
 * A missing column answers MONDAY rather than throwing. Migration 119 is applied
 * by hand in the SQL editor like every other one here, so there is a window where
 * the deploy is live and the column is not, and in that window PostgREST fails the
 * whole select with 42703. Falling back to Monday keeps every weekly number
 * exactly as it was before the preference existed, which is the only safe answer:
 * silently re-cutting somebody's km is worse than not offering the choice yet.
 */
/** Off since settings rev 3. */
export const PERSONAL_WEEK_START_ENABLED = false;

export async function readWeekStartDay(
  supabase: SupabaseClient,
  athleteId: string,
): Promise<WeekStartDay> {
  // Settings rev 3 (Ofer, 2026-11-21, Q7): the personal week start is REMOVED. Every
  // activity-km figure is the watch week (Mon–Sun) and the plan week stays Sunday —
  // two week notions, not three. The column (119) stays for history but is not read.
  if (!PERSONAL_WEEK_START_ENABLED) return MONDAY_WEEK;
  const { data, error } = await supabase
    .from('athletes')
    .select('week_start_day')
    .eq('id', athleteId)
    .maybeSingle();
  if (error || !data) return MONDAY_WEEK;
  return weekStartDayOf((data as { week_start_day?: unknown }).week_start_day);
}
