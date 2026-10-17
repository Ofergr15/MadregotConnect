import type { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { paceGroupKeyFor, type PaceGroupKey } from '@/lib/plans/pace-group';
import { withGroupPaces } from '@/lib/plans/watch-paces';
import { addDaysToDateStr, planWeekStartOf } from '@/lib/utils';
import { appleCandidates, deliverWeek, resolveWatchProvider } from '@/lib/watch';
import { notifyAthlete } from '@/lib/push';
import { packMovedCopy } from '@/lib/notifications/copy';
import { laneOfName, recordPackChange } from './pack-history';

type SupabaseServer = ReturnType<typeof createServerClient>;

/**
 * What happens after a member changes pack (plan: ~/.cache/madregot/pack-change).
 *
 * The watch normally needs nothing: a club week prints all three packs' paces on
 * every step (lib/plans/watch-paces.ts), and the three copies have had the same
 * structure in every week checked. This module looks anyway, for the days still
 * ahead, and re-sends only those days to this one runner if their new pack's copy
 * is a different workout — more reps, other minutes — rather than other paces.
 */

/** A step with every pace-only field removed: what is left is the workout's shape. */
function shape(step: WorkoutStep): unknown {
  const { targetPaceMinPerKm, targetPaceMaxPerKm, notes, groupPaces, repeatSteps, ...rest } = step as WorkoutStep & { groupPaces?: unknown };
  void targetPaceMinPerKm; void targetPaceMaxPerKm; void notes; void groupPaces;
  return repeatSteps ? { ...rest, repeatSteps: repeatSteps.map(shape) } : rest;
}

/**
 * Days of the week (0 = the plan week's first day) from `fromDow` on, where the
 * two packs' copies are not the same workout. Paces and pace notes don't count —
 * the watch shows every pack's pace anyway. A workout missing from either side
 * counts as different.
 */
export function daysWithDifferentShape(
  oldCopy: ParsedWorkout[],
  newCopy: ParsedWorkout[],
  fromDow: number,
): number[] {
  const a = normalizeWorkoutParts({ workouts: oldCopy }).workouts;
  const b = normalizeWorkoutParts({ workouts: newCopy }).workouts;
  const key = (w: ParsedWorkout) => w.workoutKey || `${w.dayOfWeek}`;
  const byKeyB = new Map(b.map((w) => [key(w), w]));
  const out = new Set<number>();
  for (const w of a) {
    if (w.dayOfWeek < fromDow) continue;
    const other = byKeyB.get(key(w));
    if (!other || JSON.stringify(w.steps.map(shape)) !== JSON.stringify(other.steps.map(shape))) out.add(w.dayOfWeek);
  }
  for (const w of b) if (w.dayOfWeek >= fromDow && !a.some((x) => key(x) === key(w))) out.add(w.dayOfWeek);
  return [...out].sort((x, y) => x - y);
}

const dowOf = (weekStart: string, date: string) =>
  Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${weekStart}T12:00:00Z`)) / 86_400_000);

/**
 * The watch check. Returns the days re-sent (usually none). Never throws.
 */
export async function resendIfShapeChanged(
  supabase: SupabaseServer,
  p: { athleteId: string; fromGroupId: string | null; toGroupId: string | null; fromDate: string },
): Promise<number[]> {
  try {
    const weekStart = planWeekStartOf(p.fromDate);
    const fromDow = dowOf(weekStart, p.fromDate);
    const [{ data: plan }, { data: groups }, { data: athlete }, { data: delivered }] = await Promise.all([
      supabase.from('weekly_plans').select('id, parsed_workouts')
        .eq('coach_id', COACH_ID).eq('week_start_date', weekStart).is('athlete_id', null)
        .in('status', ['pushed', 'partial']).order('status', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('groups').select('id, pace_profile').eq('coach_id', COACH_ID),
      supabase.from('athletes').select('id, name, email, garmin_auth').eq('id', p.athleteId).maybeSingle(),
      supabase.from('workout_deliveries').select('workout_date')
        .eq('athlete_id', p.athleteId).eq('status', 'success')
        .gte('workout_date', p.fromDate).lte('workout_date', addDaysToDateStr(weekStart, 6)),
    ]);
    const stored = plan?.parsed_workouts as Record<PaceGroupKey, { workouts?: ParsedWorkout[] }> | null;
    // Not sent to this runner this week, or a flat plan: nothing on the watch to fix.
    if (!plan || !stored || !('group1' in stored) || !athlete || !(delivered || []).length) return [];
    const sources = (groups || []).map((g: { id: string; pace_profile: { marathonGoal?: number | null } | null }) => ({
      id: g.id, marathonGoal: g.pace_profile?.marathonGoal ?? null,
    }));
    const oldKey = paceGroupKeyFor(sources, p.fromGroupId);
    const newKey = paceGroupKeyFor(sources, p.toGroupId);
    if (oldKey === newKey) return [];
    const newCopy = stored[newKey]?.workouts || [];
    const days = daysWithDifferentShape(stored[oldKey]?.workouts || [], newCopy, fromDow);
    // Only days that are on the watch now; a day never sent is the coach's to send.
    const onWatch = new Set((delivered || []).map((d: { workout_date: string }) => dowOf(weekStart, d.workout_date)));
    const resend = days.filter((d) => onWatch.has(d));
    if (resend.length === 0) return [];

    const plannedWorkouts = withGroupPaces(
      normalizeWorkoutParts({ workouts: newCopy.filter((w) => resend.includes(w.dayOfWeek)) }).workouts,
      stored,
    );
    const target = { id: athlete.id, name: athlete.name || '', garmin_auth: athlete.garmin_auth };
    const provider = resolveWatchProvider(target, await appleCandidates(supabase, [target]));
    await deliverWeek(provider, {
      supabase,
      athlete: athlete as never,
      plannedWorkouts,
      weekStartDate: weekStart,
      planId: plan.id,
      // A club week never carries pace alarms (see /api/my-watch).
      paceTarget: false,
      // The move's own push below already tells them; one notification, not two.
      notify: false,
      cleanDayOnce: true,
    });
    return resend;
  } catch (err) {
    console.error('pack-move: watch check failed', err);
    return [];
  }
}

/**
 * Everything after group_id has been written: the history row (so earlier runs keep
 * their pack), the watch check, and — when it was a coach's move, not the member's
 * own — a push telling them.
 */
export async function afterPackMove(
  supabase: SupabaseServer,
  p: {
    athleteId: string;
    fromGroupId: string | null;
    toGroupId: string | null;
    fromDate: string;
    by: 'coach' | 'self';
    byAthleteId?: string | null;
  },
): Promise<void> {
  if (p.fromGroupId === p.toGroupId) return;
  await recordPackChange(supabase, p);
  const resent = await resendIfShapeChanged(supabase, p);
  if (p.by !== 'coach' || !p.toGroupId) return;
  try {
    const { data: group } = await supabase.from('groups').select('name').eq('id', p.toGroupId).maybeSingle();
    await notifyAthlete({
      athleteId: p.athleteId,
      kind: 'pack_moved',
      actorAthleteId: p.byAthleteId ?? null,
      copy: (locale) => packMovedCopy(locale, { lane: laneOfName(group?.name), resent: resent.length > 0 }),
      url: '/dashboard/profile',
      tag: 'pack-moved',
    });
  } catch (err) {
    console.error('pack-move: push failed', err);
  }
}
