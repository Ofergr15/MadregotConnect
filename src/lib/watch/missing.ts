import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { extractWorkouts } from '@/lib/plans/workout-parsing';
import { shouldTellAthlete } from '@/lib/garmin/delivery-failure';
import { addDaysToDateStr } from '@/lib/utils';

// "What should be on this runner's watch this week and is not" (mockup watch-send-next, A1–A6)
// — the one answer behind the feed's "השבוע בשעון" card, the 20:00 reminder and the send
// after a reconnect.
//
// What counts as EXPECTED is what the club actually sent, never what the plan merely holds:
//   · the club week's days from today on, once the coach has sent that week to the watches
//     (any runner holds a confirmed delivery of it) — before that nobody is "missing" anything;
//   · a one-day session's date, when this runner was among the people it was sent to
//     (lib/day-session/watch.ts writes a row per runner it targets).
// MISSING = expected − dates with a confirmed delivery for this runner.

type Db = ReturnType<typeof createServerClient>;

export type MissingReason = 'disconnected' | 'failed';

export interface MissingOnWatch {
  /** The days that should be on the watch from today on, oldest first. */
  expected: string[];
  /** Of those, the ones that are not. */
  missing: string[];
  /** Null when nothing is missing. */
  reason: MissingReason | null;
  /** Something the runner can fix (reconnect) — what the 20:00 reminder is for. */
  fixable: boolean;
}

export interface MissingInput {
  today: string;
  weekStart: string;
  /** Days of week (0 = Sunday) holding a session in the club week. */
  planDays: number[];
  /** The coach has sent the club week (somebody holds a confirmed delivery of it). */
  clubSent: boolean;
  /** One-day session dates this runner was sent. */
  dayDates: string[];
  /** One-day dates still on the way for them (queued/sending) — not missing yet. */
  dayInFlight: string[];
  /** Dates with a confirmed delivery for this runner. */
  delivered: string[];
  garminConnected: boolean;
  /** The newest failure message for this runner this week, if any. */
  lastError: string | null;
}

/** Pure: the rule above. */
export function missingFrom(i: MissingInput): MissingOnWatch {
  const weekEnd = addDaysToDateStr(i.weekStart, 6);
  const planDates = i.clubSent ? i.planDays.map((d) => addDaysToDateStr(i.weekStart, d)) : [];
  const expected = [...new Set([...planDates, ...i.dayDates])]
    .filter((d) => d >= i.today && d <= weekEnd)
    .sort();
  const got = new Set(i.delivered);
  const flying = new Set(i.dayInFlight);
  const missing = expected.filter((d) => !got.has(d) && !flying.has(d));
  if (!missing.length) return { expected, missing, reason: null, fixable: false };
  const reason: MissingReason = i.garminConnected ? 'failed' : 'disconnected';
  return { expected, missing, reason, fixable: reason === 'disconnected' || shouldTellAthlete(i.lastError ?? undefined) };
}

interface Row { athlete_id: string; plan_id: string | null; workout_date: string; workout_key: string | null; status: string; error_message: string | null; workout_data: Record<string, unknown> | null; created_at: string }

/** The club week for `weekStart` as the sender sees it: its id, its session days, whether it went out. */
async function clubWeek(db: Db, weekStart: string) {
  const { data: plan } = await db.from('weekly_plans').select('id, parsed_workouts, status')
    .eq('coach_id', COACH_ID).eq('week_start_date', weekStart).is('athlete_id', null)
    .order('status', { ascending: false }).limit(1).maybeSingle();
  if (!plan) return { planId: null as string | null, planDays: [] as number[], clubSent: false };
  const planDays = [...new Set(extractWorkouts(plan.parsed_workouts).map((w) => w.dayOfWeek))];
  const { data: one } = await db.from('workout_deliveries').select('id').eq('plan_id', plan.id).eq('status', 'success').limit(1);
  return { planId: plan.id as string, planDays, clubSent: (one || []).length > 0 };
}

/** The answer for many runners at once — one read of the club week and one of the deliveries. */
export async function missingForAthletes(
  athletes: Array<{ id: string; garmin_auth?: unknown }>,
  weekStart: string,
  today: string,
  db: Db = createServerClient(),
): Promise<Map<string, MissingOnWatch>> {
  const out = new Map<string, MissingOnWatch>();
  if (!athletes.length) return out;
  // The club week and the deliveries do not depend on each other: together (the feed's
  // watch card waited for them one after the other).
  const [{ planId, planDays, clubSent }, { data }] = await Promise.all([
    clubWeek(db, weekStart),
    db.from('workout_deliveries')
      .select('athlete_id, plan_id, workout_date, workout_key, status, error_message, workout_data, created_at')
      .in('athlete_id', athletes.map((a) => a.id))
      .gte('workout_date', weekStart)
      .lte('workout_date', addDaysToDateStr(weekStart, 6)),
  ]);
  const rows = (data || []) as Row[];
  for (const a of athletes) {
    const mine = rows.filter((r) => r.athlete_id === a.id);
    const day = mine.filter((r) => !r.plan_id && r.workout_key?.startsWith('day:'));
    const failures = mine.filter((r) => r.status === 'failed' && (r.plan_id === planId || !r.plan_id)).sort((x, y) => x.created_at.localeCompare(y.created_at));
    out.set(a.id, missingFrom({
      today, weekStart, planDays, clubSent,
      dayDates: [...new Set(day.map((r) => r.workout_date))],
      dayInFlight: day.filter((r) => r.workout_data?.queued === true && r.status === 'pending').map((r) => r.workout_date),
      delivered: mine.filter((r) => r.status === 'success').map((r) => r.workout_date),
      garminConnected: !!a.garmin_auth,
      lastError: failures.at(-1)?.error_message ?? null,
    }));
  }
  return out;
}
