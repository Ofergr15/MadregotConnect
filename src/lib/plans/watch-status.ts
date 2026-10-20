import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { extractWorkouts } from '@/lib/plans/workout-parsing';
import { paceGroupKeyFor, type PaceGroupKey } from '@/lib/plans/pace-group';
import { addDaysToDateStr } from '@/lib/utils';
import { appleCandidates } from '@/lib/watch';

// Where a week's send to the watches stands, runner by runner and day by day (mockup
// watch-send-next, C3): the planner's tracking. Read from workout_deliveries for the plan —
// push-week writes a 'pending' row per session as Garmin takes it, promotes the batch to
// 'success' after the read-back, and writes one 'failed' row (dated the week's Sunday) when
// an athlete's delivery fails.

export type DayCell = 'ok' | 'sending' | 'waiting' | 'failed' | 'none';
export type RunnerWeekState = 'ok' | 'sending' | 'waiting' | 'failed';

export interface PlanRunner {
  athleteId: string;
  name: string;
  pack: 0 | 1 | 2;
  /** Sunday → Saturday. */
  days: DayCell[];
  state: RunnerWeekState;
  error: string | null;
  /** Confirmed sessions / sessions sent. */
  ok: number;
  total: number;
  at: string | null;
}

export interface PlanWatchStatus {
  runners: PlanRunner[];
  noWatch: Array<{ athleteId: string; name: string; pack: 0 | 1 | 2 }>;
  planDays: number[];
}

interface Row { athlete_id: string; workout_date: string; status: string; garmin_workout_id: string | null; provider?: string | null; device_confirmed_at?: string | null; superseded_at?: string | null; error_message: string | null; created_at: string }

const PACK: Record<PaceGroupKey, 0 | 1 | 2> = { group1: 0, group2: 1, group3: 2 };

/** Pure: one runner's rows → their week. */
export function runnerWeek(rows: Row[], weekStart: string, planDays: number[]): Omit<PlanRunner, 'athleteId' | 'name' | 'pack'> {
  const live = rows.filter((r) => !r.superseded_at);
  const lastFailed = live.filter((r) => r.status === 'failed').sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1) ?? null;
  const sessionRows = live.filter((r) => r.status !== 'failed');
  const lastWork = sessionRows.map((r) => r.created_at).sort().at(-1) ?? null;
  // A failure newer than every session row is the latest attempt's outcome.
  const failedNow = !!lastFailed && (!lastWork || lastFailed.created_at > lastWork);
  const days: DayCell[] = Array.from({ length: 7 }, (_, d) => {
    const date = addDaysToDateStr(weekStart, d);
    const mine = sessionRows.filter((r) => r.workout_date === date);
    if (mine.some((r) => r.provider === 'apple')) return mine.some((r) => r.device_confirmed_at) ? 'ok' : 'waiting';
    if (mine.some((r) => r.status === 'success')) return 'ok';
    if (mine.length) return failedNow ? 'failed' : 'sending';
    return planDays.includes(d) && failedNow ? 'failed' : 'none';
  });
  const sent = days.filter((c) => c !== 'none');
  const ok = sent.filter((c) => c === 'ok').length;
  const state: RunnerWeekState = failedNow ? 'failed' : sent.some((c) => c === 'sending') ? 'sending' : sent.some((c) => c === 'waiting') ? 'waiting' : 'ok';
  return { days, state, error: failedNow ? lastFailed!.error_message : null, ok, total: sent.length, at: failedNow ? lastFailed!.created_at : lastWork };
}

export async function planWatchStatus(planId: string, weekStart: string): Promise<PlanWatchStatus> {
  const db = createServerClient();
  const [{ data: plan }, { data: rowsData }, { data: members }, { data: groups }] = await Promise.all([
    db.from('weekly_plans').select('parsed_workouts').eq('id', planId).maybeSingle(),
    db.from('workout_deliveries')
      .select('athlete_id, workout_date, status, garmin_workout_id, provider, device_confirmed_at, superseded_at, error_message, created_at')
      .eq('plan_id', planId),
    db.from('athletes').select('id, name, garmin_auth:has_garmin, group_id').eq('coach_id', COACH_ID).eq('status', 'active'),
    db.from('groups').select('id, pace_profile').eq('coach_id', COACH_ID),
  ]);
  const planDays = [...new Set(extractWorkouts(plan?.parsed_workouts).map((w) => w.dayOfWeek))];
  const rows = (rowsData || []) as Row[];
  const all = (members || []) as Array<{ id: string; name: string | null; garmin_auth?: unknown; group_id?: string | null }>;
  const sources = (groups || []).map((g: { id: string; pace_profile: { marathonGoal?: number | null } | null }) => ({ id: g.id, marathonGoal: g.pace_profile?.marathonGoal ?? null }));
  const pack = (gid?: string | null) => PACK[paceGroupKeyFor(sources, gid)] ?? 1;
  const apple = await appleCandidates(db, all.map((a) => ({ id: a.id, name: a.name || '', garmin_auth: a.garmin_auth })) as never);
  const ids = [...new Set(rows.map((r) => r.athlete_id))];
  const byId = new Map(all.map((a) => [a.id, a]));
  return {
    planDays,
    runners: ids.map((id) => ({
      athleteId: id, name: byId.get(id)?.name || '', pack: pack(byId.get(id)?.group_id),
      ...runnerWeek(rows.filter((r) => r.athlete_id === id), weekStart, planDays),
    })).sort((a, b) => a.pack - b.pack || a.name.localeCompare(b.name)),
    noWatch: all.filter((a) => !a.garmin_auth && !apple.has(a.id))
      .map((a) => ({ athleteId: a.id, name: a.name || '', pack: pack(a.group_id) }))
      .sort((a, b) => a.pack - b.pack || a.name.localeCompare(b.name)),
  };
}
