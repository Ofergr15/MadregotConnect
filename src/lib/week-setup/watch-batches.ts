import type { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { paceGroupKeyFor, type PaceGroupSource } from '@/lib/plans/pace-group';
import { selectedSessions } from '@/lib/plans/push-selection';
import type { ParsedWorkout } from '@/lib/ai/types';

type Db = ReturnType<typeof createServerClient>;

/**
 * The week's send to the watches, prepared on the server for the Saturday screen's last step
 * (lib/week-setup, 10-24) — the planner's own recipe (plan/new pushToAthletes), not a second
 * one: every active runner with Garmin, batched by pace group (lib/plans/pace-group, fastest
 * goal first, the groups in /api/groups' order), each group the whole week of its variant
 * (lib/plans/push-selection). The send itself is the same route the planner calls
 * (api/garmin/push-workouts). Personal weeks are a planner-sheet-only thing (never stored),
 * so a whole-week send here has none. `only`: a resend to these runners.
 */
export async function watchBatches(supabase: Db, weekStart: string, only?: string[] | null): Promise<{
  planId: string; batches: Array<{ workouts: ParsedWorkout[]; athleteIds: string[] }>; runners: number;
} | null> {
  const [{ data: plans }, { data: groups }, { data: athletes }] = await Promise.all([
    supabase.from('weekly_plans').select('id, parsed_workouts, created_at').eq('coach_id', COACH_ID).is('athlete_id', null)
      .eq('week_start_date', weekStart).order('created_at', { ascending: false }).limit(1),
    supabase.from('groups').select('id, pace_profile').eq('coach_id', COACH_ID).order('created_at', { ascending: true }),
    supabase.from('athletes').select('id, group_id').eq('coach_id', COACH_ID).eq('status', 'active').eq('has_garmin', true),
  ]);
  const plan = (plans ?? [])[0] as { id: string; parsed_workouts: Record<string, { workouts?: ParsedWorkout[] }> } | undefined;
  if (!plan) return null;
  const sources: PaceGroupSource[] = ((groups ?? []) as Array<{ id: string; pace_profile: { marathonGoal?: string | number } | null }>)
    .map((g) => ({ id: g.id, marathonGoal: g.pace_profile?.marathonGoal || '' }));
  const people = ((athletes ?? []) as Array<{ id: string; group_id: string | null }>).filter((a) => !only || only.includes(a.id));
  const byGroup: Record<string, string[]> = { group1: [], group2: [], group3: [] };
  for (const a of people) byGroup[paceGroupKeyFor(sources, a.group_id)].push(a.id);
  const batches = Object.entries(byGroup)
    .filter(([, ids]) => ids.length)
    .map(([g, ids]) => ({ workouts: selectedSessions(plan.parsed_workouts?.[g]?.workouts ?? [], null), athleteIds: ids }))
    .filter((b) => b.workouts.length);
  return { planId: plan.id, batches, runners: batches.reduce((a, b) => a + b.athleteIds.length, 0) };
}
