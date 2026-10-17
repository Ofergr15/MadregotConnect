import { createServerClient } from '@/lib/supabase/server';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
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
// There is no weekly plan row to hang deliveries on, so the Garmin ids this sends are kept
// on the session itself (migration 152, `watch_deliveries`): a second send deletes the
// first copy off each watch before writing the new one. Before 152 is pasted the send
// still works, but a second send leaves the first copy on the watch beside it — `tracked`
// says which.

type Db = ReturnType<typeof createServerClient>;
interface Deliveries { sentAt: string; ids: Record<string, string[]> }

const AT_ONCE = 3;

async function readDeliveries(db: Db, id: string): Promise<{ tracked: boolean; prior: Deliveries | null }> {
  const { data, error } = await db.from('day_sessions').select('watch_deliveries').eq('id', id).maybeSingle();
  if (error) return { tracked: !isMissingColumn(error, 'watch_deliveries'), prior: null };
  const v = (data as { watch_deliveries?: unknown } | null)?.watch_deliveries;
  return { tracked: true, prior: v && typeof v === 'object' && 'ids' in v ? (v as Deliveries) : null };
}

export interface WatchSendResult {
  /** False before migration 152: a second send will not replace the first copy. */
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

  const { tracked, prior } = await readDeliveries(db, s.id);
  const appleIds = await appleCandidates(db, athletes as never);
  const results: PushResult[] = [];
  const sentIds: Record<string, string[]> = { ...(prior?.ids ?? {}) };

  const deliver = async (athlete: (typeof athletes)[number]) => {
    const own: ParsedWorkout[] = grouped[paceGroupKeyFor(sources, athlete.group_id)]?.workouts ?? base;
    const plannedWorkouts = withGroupPaces(normalizeWorkoutParts({ workouts: own }).workouts, grouped);
    const provider = resolveWatchProvider(athlete as never, appleIds);
    if (provider !== 'apple') {
      // The earlier copy of this session off this watch, first.
      const old = prior?.ids?.[athlete.id] ?? [];
      if (old.length && athlete.garmin_auth) {
        const garmin = new GarminClient(athlete.garmin_auth as never);
        for (const id of old) {
          try { await garmin.deleteWorkout(id); } catch { /* already gone: send the new one regardless */ }
        }
        delete sentIds[athlete.id];
      }
    }
    const input = {
      supabase: db, athlete: athlete as never, plannedWorkouts, weekStartDate, planId: null,
      // A club session: the pace is text on the watch, never an alarm.
      paceTarget: false,
      // The session's own push already told everyone; one more about the watch is noise.
      notify: false,
    };
    const result: PushResult = provider === 'apple'
      ? await deliverWeek('apple', input)
      : await pushWeekToAthlete({ ...input, cleanDayOnce: true });
    if (result.status === 'success' && result.workoutIds?.length) sentIds[athlete.id] = result.workoutIds;
    results.push(result);
  };

  let next = 0;
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, athletes.length) }, async () => {
    while (next < athletes.length) await deliver(athletes[next++]!);
  }));

  if (tracked) {
    const value: Deliveries = { sentAt: new Date().toISOString(), ids: sentIds };
    await db.from('day_sessions').update({ watch_deliveries: value }).eq('id', s.id);
  }
  return { tracked, results };
}
