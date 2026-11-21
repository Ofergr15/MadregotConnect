import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { getPlanWeekStart, israelNow, israelToday } from '@/lib/utils';
import { pickPlan, planRowsFilter } from '@/lib/plans/scope';
import { ownPlanRowsCount, withoutOwnRows } from '@/lib/plans/scope-server';
import { buildWeekBreakdown } from '@/lib/plans/workout-parsing';
import { normalizeAvailability, sessionKind } from '@/lib/coach/attention';
import type { ParsedWorkout } from '@/lib/ai/types';
import {
  plannedKindOf, shouldAskFeedback, type PlannedKind, type PromptDecision, type PromptHistoryRow,
} from './prompt-rules';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

const LONG_NAME = /ארוכ|long/i;

/** The plan's kind for one date — the athlete's own academy week wins (lib/plans/scope). */
export async function plannedKindForDate(db: Db, dateStr: string, athleteId: string): Promise<PlannedKind | null> {
  const weekStart = getPlanWeekStart(new Date(`${dateStr}T12:00:00`));
  const [{ data: rowsRaw }, ownCounts] = await Promise.all([
    db.from('weekly_plans').select('parsed_workouts, status, athlete_id').eq('coach_id', COACH_ID)
      .or(planRowsFilter(athleteId)).eq('week_start_date', weekStart).order('created_at', { ascending: true }),
    ownPlanRowsCount(athleteId),
  ]);
  const plan = pickPlan(withoutOwnRows(rowsRaw, ownCounts), athleteId);
  if (!plan?.parsed_workouts) return null;
  const dow = new Date(`${dateStr}T12:00:00`).getDay();
  const workouts = (plan.parsed_workouts as ParsedWorkout[]).filter((w) => w.dayOfWeek === dow);
  if (!workouts.length) return null;
  const day = buildWeekBreakdown(plan.parsed_workouts).dailyDistances.find((d) => d.dayOfWeek === dow);
  const km = day?.requiredMax ?? day?.max ?? 0; // km
  const kinds = workouts.map(sessionKind);
  const kind = kinds.includes('quality') ? 'quality' : kinds.includes('easy') ? 'easy' : 'other';
  const isLong = workouts.some((w) => LONG_NAME.test(`${w.workoutName ?? ''} ${w.name ?? ''}`));
  return plannedKindOf(kind, km, isLong);
}

export async function promptHistory(db: Db, athleteId: string): Promise<PromptHistoryRow[]> {
  const { data } = await db.from('feedback_prompts')
    .select('created_at, mode, planned_kind, pushed, pushed_on, answered_at, dismissed_at')
    .eq('athlete_id', athleteId).order('created_at', { ascending: false }).limit(30);
  return ((data || []) as Array<Record<string, unknown>>).map((r) => ({
    createdAt: String(r.created_at), mode: r.mode as PromptHistoryRow['mode'],
    plannedKind: (r.planned_kind as PlannedKind | null) ?? null, pushed: !!r.pushed,
    pushedOn: (r.pushed_on as string | null) ?? null, answeredAt: (r.answered_at as string | null) ?? null,
    dismissedAt: (r.dismissed_at as string | null) ?? null,
  }));
}

/**
 * Evaluate one matched run for an athlete who has feedback_pain switched on, and
 * record the decision (every run gets a row — it is the 1-in-4 sampling history).
 * Returns null when the run was already evaluated or the table is missing.
 */
export async function evaluateFeedbackPrompt(
  db: Db,
  opts: { athleteId: string; activityId: string; dateStr: string; distanceKm: number; now?: Date },
): Promise<PromptDecision | null> {
  const now = opts.now ?? new Date();
  const { data: existing, error: exErr } = await db.from('feedback_prompts').select('id')
    .eq('athlete_id', opts.athleteId).eq('activity_id', opts.activityId).maybeSingle();
  if (exErr || existing) return null;
  const [{ data: a }, kind, history] = await Promise.all([
    db.from('athletes').select('availability').eq('id', opts.athleteId).maybeSingle(),
    plannedKindForDate(db, opts.dateStr, opts.athleteId).catch(() => null),
    promptHistory(db, opts.athleteId),
  ]);
  const decision = shouldAskFeedback(
    { activityId: opts.activityId, distanceKm: opts.distanceKm },
    { kind },
    history,
    { now, israelHour: israelNow(now).hour, israelDate: israelToday(now), availability: normalizeAvailability(a?.availability) },
  );
  const { error } = await db.from('feedback_prompts').insert({
    athlete_id: opts.athleteId, activity_id: opts.activityId, planned_kind: kind, mode: decision.mode,
    pushed: decision.push, pushed_on: decision.push ? israelToday(now) : null, held: decision.held ?? null,
  });
  if (error) return null;
  return decision;
}
