import { createServerClient } from '@/lib/supabase/server';
import { isAcademyOnly } from '@/lib/plans/scope';

/**
 * Does this reader's OWN plan row still count? Only while they are in the academy
 * (launch report N13): a removed trainee's future personal weeks stayed preferred over
 * the club's (lib/plans/scope.ts ranks "own" first whatever `is_academy` says), so the
 * club home kept showing the academy plan of someone who had left it.
 *
 * Fails OPEN — an error or a missing row keeps today's behaviour (own rows count),
 * because hiding a real trainee's plan is the worse failure. Uncached on purpose: the
 * plan reads beside it are cached for 300 s, and a removal must take effect now. Run it
 * beside the plan query, not before it.
 */
export async function ownPlanRowsCount(athleteId: string | null | undefined): Promise<boolean> {
  if (!athleteId) return false;
  try {
    const { data, error } = await createServerClient()
      .from('athletes')
      .select('is_academy')
      .eq('id', athleteId)
      .maybeSingle();
    if (error || !data) return true;
    return (data as { is_academy?: boolean | null }).is_academy !== false;
  } catch {
    return true;
  }
}

/**
 * A personal week written by hand for one athlete (`add_personal_workout`, migration 176):
 * the club's week with that athlete's own day(s) swapped in, flagged `manual: true` on the
 * blob. It is theirs whether or not they are in the academy (2026-11-01).
 */
export function isManualPlan(row: { parsed_workouts?: unknown } | null | undefined): boolean {
  const blob = row?.parsed_workouts as { manual?: unknown } | null | undefined;
  return !!blob && typeof blob === 'object' && blob.manual === true;
}

/** Drop the reader's own rows when they no longer count. A manual week always counts. */
export function withoutOwnRows<T extends { athlete_id?: string | null; parsed_workouts?: unknown }>(rows: T[] | null | undefined, ownCount: boolean): T[] {
  const list = rows || [];
  return ownCount ? list : list.filter((r) => !r.athlete_id || isManualPlan(r));
}

/**
 * Is this reader academy-only (in the academy, no club group — lib/plans/scope.ts isAcademyOnly)?
 * Such a reader has no club week: the club's rows and one-day sessions are not served to them
 * (QA 11-18: the feed showed an academy-only trainee with no plan the CLUB week and a
 * "not on the watch" warning for it). Fails CLOSED to "club member" (false): an error keeps
 * today's behaviour. Uncached for the same reason as ownPlanRowsCount.
 */
export async function academyOnlyReader(athleteId: string | null | undefined): Promise<boolean> {
  if (!athleteId) return false;
  try {
    const { data, error } = await createServerClient()
      .from('athletes')
      .select('is_academy, group_id')
      .eq('id', athleteId)
      .maybeSingle();
    if (error || !data) return false;
    return isAcademyOnly(data as { is_academy?: boolean | null; group_id?: string | null });
  } catch {
    return false;
  }
}
