import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import type { ParsedWorkout } from '@/lib/ai/types';
import { splitIntoGroups } from '@/lib/ai/splitGroups';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { withGroupPaces } from '@/lib/plans/watch-paces';
import { paceGroupKeyFor } from '@/lib/plans/pace-group';
import { GarminClient } from '@/lib/garmin/client';
import { pushWeekToAthlete, type PushResult } from '@/lib/garmin/push-week';
import { appleCandidates, deliverWeek, resolveWatchProvider } from '@/lib/watch';
import { getPlanWeekStart } from '@/lib/utils';
import type { DaySession } from './model';

// "לשלוח לשעונים" for a one-day session — the planner's delivery (lib/garmin/push-week.ts,
// Apple through lib/watch), so it reaches the watch exactly the way a planned session does:
// each runner gets their own pack's paces, with all three packs' paces on every step (the
// club week's rule, lib/plans/watch-paces.ts), and never pace-zone alarms.
//
// There is no weekly plan row, so the deliveries are recorded with `plan_id` null and the
// key `day:<date>` (deliveryKey) — the same workout_deliveries the planner writes, so the
// runner's watch status on the feed (my-watch) shows the day as on the watch, and the
// form can say who has it. A second send deletes the first copy off each watch, and its
// rows, before writing the new one.

type Db = ReturnType<typeof createServerClient>;

const AT_ONCE = 3;

export const dayKey = (date: string) => `day:${date}`;

interface DeliveryRow { id: string; athlete_id: string; garmin_workout_id: string | null; status: string; created_at: string }

async function readRows(db: Db, date: string, athleteIds?: string[]): Promise<DeliveryRow[]> {
  let q = db.from('workout_deliveries')
    .select('id, athlete_id, garmin_workout_id, status, created_at')
    .is('plan_id', null)
    .eq('workout_key', dayKey(date))
    .eq('workout_date', date);
  if (athleteIds) q = q.in('athlete_id', athleteIds);
  const { data, error } = await q;
  return error ? [] : ((data || []) as DeliveryRow[]);
}

export interface WatchHolder { athleteId: string; name: string; at: string }

/** Who has the date's session on their watch (a confirmed delivery). */
export async function whoHasIt(date: string): Promise<WatchHolder[]> {
  const db = createServerClient();
  const rows = (await readRows(db, date)).filter((r) => r.status === 'success');
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.athlete_id))];
  const { data } = await db.from('athletes').select('id, name').in('id', ids);
  const names = new Map(((data || []) as Array<{ id: string; name: string | null }>).map((a) => [a.id, a.name || '']));
  return ids.map((id) => ({ athleteId: id, name: names.get(id) || '', at: rows.filter((r) => r.athlete_id === id).map((r) => r.created_at).sort().at(-1)! }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

export interface WatchSendResult {
  /** Kept for the form: always true now that the deliveries are workout_deliveries rows. */
  tracked: boolean;
  results: PushResult[];
}

export async function sendDaySessionToWatches(s: DaySession, athleteIds: string[]): Promise<WatchSendResult> {
  const db = createServerClient();
  const { data: rows } = await db.from('athletes')
    .select('id, name, garmin_auth, group_id, groups!group_id(pace_profile)')
    .in('id', athleteIds.length ? athleteIds : ['00000000-0000-0000-0000-000000000000'])
    .eq('status', 'active');
  const athletes = (rows || []) as Array<{ id: string; name: string; garmin_auth?: unknown; group_id?: string | null; groups?: { pace_profile?: unknown } | null }>;
  if (!athletes.length) return { tracked: true, results: [] };

  const { data: groups } = await db.from('groups').select('id, pace_profile').eq('coach_id', COACH_ID);
  const sources = (groups || []).map((g: { id: string; pace_profile: { marathonGoal?: number | null } | null }) => ({
    id: g.id, marathonGoal: g.pace_profile?.marathonGoal ?? null,
  }));

  // One session, the planner's shape, and each pack's copy of it.
  const dayOfWeek = new Date(`${s.date}T12:00:00`).getDay();
  const base = normalizeWorkoutParts({ workouts: [{ dayOfWeek, name: s.title || 'אימון', steps: s.steps }] }).workouts;
  const grouped = splitIntoGroups({ workouts: base });
  const weekStartDate = getPlanWeekStart(new Date(`${s.date}T12:00:00`));

  const prior = await readRows(db, s.date, athletes.map((x) => x.id));
  const appleIds = await appleCandidates(db, athletes as never);
  const results: PushResult[] = [];

  const deliver = async (athlete: (typeof athletes)[number]) => {
    const own: ParsedWorkout[] = grouped[paceGroupKeyFor(sources, athlete.group_id)]?.workouts ?? base;
    const plannedWorkouts = withGroupPaces(normalizeWorkoutParts({ workouts: own }).workouts, grouped);
    const provider = resolveWatchProvider(athlete as never, appleIds);
    // The earlier copy of this session off this watch, and its rows, first.
    const old = prior.filter((r) => r.athlete_id === athlete.id);
    if (provider !== 'apple' && athlete.garmin_auth) {
      const garmin = new GarminClient(athlete.garmin_auth as never);
      for (const r of old) {
        if (!r.garmin_workout_id) continue;
        try { await garmin.deleteWorkout(r.garmin_workout_id); } catch { /* already gone: send the new one regardless */ }
      }
    }
    if (old.length) await db.from('workout_deliveries').delete().in('id', old.map((r) => r.id));
    const input = {
      supabase: db, athlete: athlete as never, plannedWorkouts, weekStartDate, planId: null,
      // A club session: the pace is text on the watch, never an alarm.
      paceTarget: false,
      // The session's own push already told everyone; one more about the watch is noise.
      notify: false,
    };
    const result: PushResult = provider === 'apple'
      ? await deliverWeek('apple', input)
      : await pushWeekToAthlete({ ...input, cleanDayOnce: true, deliveryKey: dayKey(s.date) });
    results.push(result);
  };

  let next = 0;
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, athletes.length) }, async () => {
    while (next < athletes.length) await deliver(athletes[next++]!);
  }));

  return { tracked: true, results };
}
