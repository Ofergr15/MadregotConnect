import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import type { ParsedWorkout } from '@/lib/ai/types';
import { splitIntoGroups } from '@/lib/ai/splitGroups';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { withGroupPaces } from '@/lib/plans/watch-paces';
import { paceGroupKeyFor, type PaceGroupKey } from '@/lib/plans/pace-group';
import { GarminClient } from '@/lib/garmin/client';
import { pushWeekToAthlete, type PushResult } from '@/lib/garmin/push-week';
import { shouldTellAthlete } from '@/lib/garmin/delivery-failure';
import { watchDisconnectedCopy } from '@/lib/notifications/copy';
import { notifyAthlete } from '@/lib/push';
import { appleCandidates, deliverWeek, resolveWatchProvider } from '@/lib/watch';
import { getPlanWeekStart } from '@/lib/utils';
import type { DaySession } from './model';
import { countsOf, statusOf, type DeliveryLike, type RunnerStatus } from './watch-status';

// "לשלוח לשעונים" for a one-day session (mockup watch-send-v3) — the planner's delivery
// (lib/garmin/push-week.ts, Apple through lib/watch), so it reaches the watch exactly the way
// a planned session does: each runner gets their own pack's paces, with all three packs' paces
// on every step (the club week's rule, lib/plans/watch-paces.ts), and never pace-zone alarms.
//
// The deliveries are workout_deliveries rows with `plan_id` null and the key `day:<date>`, so
// the runner's watch status on the feed (my-watch) sees the day as on the watch. A send:
//   1. writes a QUEUE row per runner (lib/day-session/watch-status.ts) and answers at once;
//   2. delivers three at a time in the background, each runner's earlier copy of this session
//      deleted off the watch first; the queue row goes on success, becomes the failure (with
//      Garmin's reason) when not;
//   3. tells the coach how it went, in one push.
// The tracking screen reads the rows (watchStatus) while that runs and at any time after.

type Db = ReturnType<typeof createServerClient>;

const AT_ONCE = 3;
const PACK: Record<PaceGroupKey, 0 | 1 | 2> = { group1: 0, group2: 1, group3: 2 };

export const dayKey = (date: string) => `day:${date}`;

interface Row extends DeliveryLike { id: string; workout_key?: string | null }

const ROW_COLS = 'id, athlete_id, status, garmin_workout_id, provider, device_confirmed_at, superseded_at, error_message, workout_data, workout_key, created_at';

/** The date's plan-less rows: ours by key, and Apple's (its adapter keys them itself). */
async function readRows(db: Db, date: string, athleteIds?: string[]): Promise<Row[]> {
  let q = db.from('workout_deliveries').select(ROW_COLS).is('plan_id', null).eq('workout_date', date)
    .or(`workout_key.eq.${dayKey(date)},provider.eq.apple`);
  if (athleteIds) q = q.in('athlete_id', athleteIds);
  const { data, error } = await q;
  if (!error) return (data || []) as Row[];
  // Before the Apple columns (migration 138): ours alone, by key.
  let basic = db.from('workout_deliveries').select('id, athlete_id, status, garmin_workout_id, error_message, workout_data, workout_key, created_at')
    .is('plan_id', null).eq('workout_date', date).eq('workout_key', dayKey(date));
  if (athleteIds) basic = basic.in('athlete_id', athleteIds);
  const second = await basic;
  if (second.error) console.error('[day-session/watch] rows unreadable:', second.error.message);
  return (second.data || []) as Row[];
}

type Athlete = { id: string; name: string; garmin_auth?: unknown; group_id?: string | null; groups?: { pace_profile?: unknown } | null };

async function club(db: Db) {
  const { data: groups } = await db.from('groups').select('id, pace_profile').eq('coach_id', COACH_ID);
  const sources = (groups || []).map((g: { id: string; pace_profile: { marathonGoal?: number | null } | null }) => ({
    id: g.id, marathonGoal: g.pace_profile?.marathonGoal ?? null,
  }));
  return { packKey: (groupId: string | null | undefined) => paceGroupKeyFor(sources, groupId) };
}

// ── The send ───────────────────────────────────────────────────────────────────────────

export interface StartedSend { queued: number; skipped: number; work: Promise<void> }

/**
 * Queue the runners and start delivering. `work` is the delivery itself, for the route to keep
 * alive past its answer (`after`). Runners with no watch to write to are skipped, not queued.
 */
export async function startDaySessionSend(s: DaySession, athleteIds: string[], senderId: string | null): Promise<StartedSend> {
  const db = createServerClient();
  const { data: rows } = await db.from('athletes')
    .select('id, name, garmin_auth, group_id, groups!group_id(pace_profile)')
    .in('id', athleteIds.length ? athleteIds : ['00000000-0000-0000-0000-000000000000'])
    .eq('status', 'active');
  const found = (rows || []) as Athlete[];
  const appleIds = await appleCandidates(db, found as never);
  const athletes = found.filter((a) => !!a.garmin_auth || appleIds.has(a.id));
  const skipped = athleteIds.length - athletes.length;
  if (!athletes.length) return { queued: 0, skipped, work: Promise.resolve() };

  // One session in the planner's shape, and each pack's copy of it.
  const dayOfWeek = new Date(`${s.date}T12:00:00`).getDay();
  const base = normalizeWorkoutParts({ workouts: [{ dayOfWeek, name: s.title || 'אימון', steps: s.steps }] }).workouts;
  const grouped = splitIntoGroups({ workouts: base });
  const weekStartDate = getPlanWeekStart(new Date(`${s.date}T12:00:00`));
  const { packKey } = await club(db);

  const prior = (await readRows(db, s.date, athletes.map((a) => a.id))).filter((r) => r.workout_key === dayKey(s.date));
  const { data: queuedRows } = await db.from('workout_deliveries').insert(athletes.map((a) => ({
    plan_id: null, athlete_id: a.id, workout_date: s.date, workout_key: dayKey(s.date),
    workout_data: { queued: true }, status: 'pending',
  }))).select('id, athlete_id');
  const queueOf = new Map(((queuedRows || []) as Array<{ id: string; athlete_id: string }>).map((r) => [r.athlete_id, r.id]));

  const results: PushResult[] = [];
  const deliver = async (athlete: Athlete) => {
    const queueId = queueOf.get(athlete.id);
    if (queueId) await db.from('workout_deliveries').update({ workout_data: { queued: true, started: true } }).eq('id', queueId);
    let result: PushResult;
    try {
      const own: ParsedWorkout[] = grouped[packKey(athlete.group_id)]?.workouts ?? base;
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
      result = provider === 'apple'
        ? await deliverWeek('apple', input)
        : await pushWeekToAthlete({ ...input, cleanDayOnce: true, deliveryKey: dayKey(s.date) });
    } catch (err) {
      result = { athleteId: athlete.id, athleteName: athlete.name, status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
    results.push(result);
    if (queueId) {
      if (result.status === 'success') await db.from('workout_deliveries').delete().eq('id', queueId);
      else await db.from('workout_deliveries').update({ status: 'failed', error_message: result.error || 'failed', workout_data: { queued: true, started: true } }).eq('id', queueId);
    }
    // The runner hears about it only when it is theirs to fix (a dead Garmin link) — the
    // planner's rule (lib/garmin/delivery-failure.ts).
    if (result.status === 'failed' && shouldTellAthlete(result.error)) {
      try {
        await notifyAthlete({
          athleteId: athlete.id, kind: 'watch_disconnected', copy: watchDisconnectedCopy,
          url: '/dashboard/profile?tab=datasource', tag: `watch-disconnected-${athlete.id}-${weekStartDate}`, category: 'workouts',
        });
      } catch { /* best-effort */ }
    }
  };

  const work = (async () => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, athletes.length) }, async () => {
      while (next < athletes.length) await deliver(athletes[next++]!);
    }));
    // One push to the coach with how it went.
    if (senderId) {
      const ok = results.filter((r) => r.status === 'success').length;
      try {
        await notifyAthlete({
          athleteId: senderId, kind: 'day_session_watch',
          title: `בשעון אצל ${ok} מתוך ${results.length}`,
          body: ok === results.length ? 'האימון הגיע לכל השעונים' : `${results.length - ok} לא קיבלו. נגיעה כדי לראות מי ולשלוח שוב`,
          url: `/dashboard/day-session?date=${s.date}&track=1`, tag: `day-session-watch-${s.date}`, category: 'management',
        });
      } catch { /* best-effort */ }
    }
  })();
  return { queued: athletes.length, skipped, work };
}

// ── The tracking ───────────────────────────────────────────────────────────────────────

export interface RunnerRow extends RunnerStatus { name: string; pack: 0 | 1 | 2 }

export interface WatchStatusAnswer {
  /** The last send's first queue time; null = never sent. */
  sentAt: string | null;
  runners: RunnerRow[];
  counts: ReturnType<typeof countsOf>;
  /** Active members with no watch to write to — "בלי שעון מחובר". */
  noWatch: Array<{ athleteId: string; name: string; pack: 0 | 1 | 2 }>;
}

export async function watchStatus(date: string): Promise<WatchStatusAnswer> {
  const db = createServerClient();
  const rows = await readRows(db, date);
  const runners = statusOf(rows);
  const { data: members } = await db.from('athletes').select('id, name, garmin_auth, group_id').eq('coach_id', COACH_ID).eq('status', 'active');
  const all = (members || []) as Athlete[];
  const appleIds = await appleCandidates(db, all as never);
  const { packKey } = await club(db);
  const byId = new Map(all.map((a) => [a.id, a]));
  const pack = (id: string) => PACK[packKey(byId.get(id)?.group_id)] ?? 1;
  return {
    sentAt: rows.length ? rows.map((r) => r.created_at).sort()[0] : null,
    runners: runners
      .map((r) => ({ ...r, name: byId.get(r.athleteId)?.name || '', pack: pack(r.athleteId) }))
      .sort((a, b) => a.pack - b.pack || a.name.localeCompare(b.name)),
    counts: countsOf(runners),
    noWatch: all.filter((a) => !a.garmin_auth && !appleIds.has(a.id))
      .map((a) => ({ athleteId: a.id, name: a.name || '', pack: pack(a.id) }))
      .sort((a, b) => a.pack - b.pack || a.name.localeCompare(b.name)),
  };
}
