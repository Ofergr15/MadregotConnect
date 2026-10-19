import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import type { ParsedWorkout } from '@/lib/ai/types';
import { splitIntoGroups } from '@/lib/ai/splitGroups';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { withGroupPaces } from '@/lib/plans/watch-paces';
import { paceGroupKeyFor, type PaceGroupKey } from '@/lib/plans/pace-group';
import { GarminClient } from '@/lib/garmin/client';
import { pushWeekToAthlete, type PushResult } from '@/lib/garmin/push-week';
import { notifyAthlete } from '@/lib/push';
import { appleCandidates, deliverWeek, resolveWatchProvider } from '@/lib/watch';
import { addDaysToDateStr, getPlanWeekStart, israelNow, israelToday } from '@/lib/utils';
import { shouldTellAthlete } from '@/lib/garmin/delivery-failure';
import { EVENING_KIND } from '@/lib/watch/evening-reminder';
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
/** From this hour a send for tomorrow comes after the 20:00 reminder, so it brings its own. */
const SYNC_NUDGE_FROM_HOUR = 20;
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
    // The runner is not told now: the 20:00 reminder covers it (lib/watch/evening-reminder.ts),
    // and reconnecting sends it by itself (lib/watch/reconnect.ts).
  };

  const work = (async () => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, athletes.length) }, async () => {
      while (next < athletes.length) await deliver(athletes[next++]!);
    }));
    // A session for TOMORROW sent after 20:00 missed the evening reminder, and Garmin only
    // has it on the account: it reaches the watch at the next sync. One push to each runner
    // it reached, so the watch has it by the morning (2026-10-19 — 19.10 was on Ofer's
    // account and not on his watch at 07:05).
    const nowParts = israelNow();
    if (s.date === addDaysToDateStr(israelToday(), 1) && nowParts.hour >= SYNC_NUDGE_FROM_HOUR) {
      for (const r of results.filter((x) => x.status === 'success')) {
        try {
          await notifyAthlete({
            athleteId: r.athleteId, kind: 'watch_sync',
            title: 'האימון של מחר נשלח ל־Garmin',
            body: 'פתחו את Garmin Connect לרגע כדי שיסונכרן לשעון',
            url: '/feed', tag: `watch-sync-${s.date}`, category: 'workouts',
          });
        } catch { /* best-effort */ }
      }
    }
    // One push to the coach with how it went.
    if (senderId) {
      const ok = results.filter((r) => r.status === 'success').length;
      try {
        await notifyAthlete({
          athleteId: senderId, kind: 'day_session_watch',
          // Garmin accepted it — the account, not the device; it shows on a watch after a sync.
          title: `נשלח ל־Garmin אצל ${ok} מתוך ${results.length}`,
          body: ok === results.length ? 'האימון נשלח ל־Garmin של כולם. הוא יופיע בשעון אחרי סנכרון' : `${results.length - ok} לא קיבלו. נגיעה כדי לראות מי ולשלוח שוב`,
          url: `/dashboard/day-session?date=${s.date}&track=1`, tag: `day-session-watch-${s.date}`, category: 'management',
        });
      } catch { /* best-effort */ }
    }
  })();
  return { queued: athletes.length, skipped, work };
}

// ── Taking it off the watches (Ofer, 2026-10-18) ───────────────────────────────────────
//
// A send is recorded in one of two places, by age: the first version of "לשלוח לשעונים"
// kept the Garmin ids on the session itself (day_sessions.watch_deliveries.ids,
// { athleteId: [garminWorkoutId] }, migration 152); the current one writes workout_deliveries
// rows keyed `day:<date>`. Reading only the rows would call a session sent the old way
// "on no watch" and leave it on all of them — so both are read, per runner.
//
// The screen removes one runner at a time and shows each answer: deleted, then ASKED BACK —
// only Garmin saying the workout is gone counts as removed. Apple watches read the rows, so
// for them dropping the rows is the removal.

export interface WatchHolder {
  athleteId: string;
  name: string;
  garminIds: string[];
  apple: boolean;
}

/** Both records of a send, per runner: Garmin ids from either, and whether Apple has it. Pure. */
export function mergeHolders(
  date: string,
  rows: Array<Pick<DeliveryLike, 'athlete_id' | 'garmin_workout_id' | 'provider'> & { workout_key?: string | null }>,
  legacy: unknown,
): Map<string, { garmin: Set<string>; apple: boolean }> {
  const by = new Map<string, { garmin: Set<string>; apple: boolean }>();
  const entry = (id: string) => {
    let e = by.get(id);
    if (!e) { e = { garmin: new Set(), apple: false }; by.set(id, e); }
    return e;
  };
  for (const r of rows) {
    if (r.provider === 'apple') entry(r.athlete_id).apple = true;
    else if (r.workout_key === dayKey(date)) {
      const e = entry(r.athlete_id);
      if (r.garmin_workout_id) e.garmin.add(r.garmin_workout_id);
    }
  }
  const ids = (legacy as { ids?: Record<string, unknown> } | null | undefined)?.ids || {};
  for (const [athleteId, list] of Object.entries(ids)) {
    for (const g of Array.isArray(list) ? list : []) if (typeof g === 'string' || typeof g === 'number') entry(athleteId).garmin.add(String(g));
  }
  return by;
}

/** Everybody the date's session reached, from both records. */
export async function watchHolders(date: string): Promise<WatchHolder[]> {
  const db = createServerClient();
  const [rows, legacy] = await Promise.all([
    readRows(db, date),
    db.from('day_sessions').select('watch_deliveries').eq('session_date', date).maybeSingle(),
  ]);
  const by = mergeHolders(date, rows, (legacy.data as { watch_deliveries?: unknown } | null)?.watch_deliveries);
  if (!by.size) return [];
  const { data } = await db.from('athletes').select('id, name').in('id', [...by.keys()]);
  const names = new Map(((data || []) as Array<{ id: string; name: string | null }>).map((a) => [a.id, a.name || '']));
  return [...by.entries()]
    .map(([athleteId, e]) => ({ athleteId, name: names.get(athleteId) || '', garminIds: [...e.garmin], apple: e.apple }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

export type RemoveResult =
  | { athleteId: string; status: 'removed' }
  | { athleteId: string; status: 'failed'; error: string };

/**
 * One runner's copy off their watch, then checked. Safe to repeat: a workout already gone
 * deletes as a no-op and checks as gone. The runner's day:<date> rows go only once Garmin
 * confirms, so a failure stays visible to a retry.
 */
export async function removeFromOneWatch(date: string, athleteId: string): Promise<RemoveResult> {
  const holder = (await watchHolders(date)).find((h) => h.athleteId === athleteId);
  if (!holder) return { athleteId, status: 'removed' };
  const db = createServerClient();
  if (holder.garminIds.length) {
    const { data } = await db.from('athletes').select('garmin_auth').eq('id', athleteId).maybeSingle();
    const auth = (data as { garmin_auth?: unknown } | null)?.garmin_auth;
    if (!auth) return { athleteId, status: 'failed', error: 'השעון כבר לא מחובר — אי אפשר להגיע אליו' };
    const garmin = new GarminClient(auth as never);
    try {
      for (const id of holder.garminIds) {
        try { await garmin.deleteWorkout(id); } catch { /* already gone: the check below decides */ }
        if (await garmin.workoutExists(id)) return { athleteId, status: 'failed', error: 'Garmin עדיין מראה את האימון' };
      }
    } catch (err) {
      return { athleteId, status: 'failed', error: err instanceof Error ? err.message.slice(0, 140) : String(err) };
    }
  }
  const { error } = await db.from('workout_deliveries').delete().is('plan_id', null).eq('workout_date', date).eq('athlete_id', athleteId)
    .or(`workout_key.eq.${dayKey(date)},provider.eq.apple`);
  if (error) {
    // Before the Apple columns (migration 138): ours alone, by key.
    await db.from('workout_deliveries').delete().is('plan_id', null).eq('workout_date', date).eq('athlete_id', athleteId).eq('workout_key', dayKey(date));
  }
  return { athleteId, status: 'removed' };
}

// ── The tracking ───────────────────────────────────────────────────────────────────────

export interface RunnerRow extends RunnerStatus {
  name: string;
  pack: 0 | 1 | 2;
  /**
   * For a failure they can fix: the 20:00 reminder the evening before (lib/watch/evening-reminder.ts)
   * — 'tonight' while it is still to come, the time once it went, null when there is none (the
   * session is today, or the failure is Garmin's).
   */
  reminder: 'tonight' | string | null;
}

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
  // The 20:00 reminder only ever covers tomorrow's session.
  const today = israelToday();
  const remindable = date > today;
  const fixableIds = runners.filter((r) => r.state === 'failed' && (shouldTellAthlete(r.error) || !byId.get(r.athleteId)?.garmin_auth)).map((r) => r.athleteId);
  const sentAt = new Map<string, string>();
  if (remindable && fixableIds.length) {
    const { data: rem } = await db.from('scheduled_notifications').select('audience_id, last_sent_at')
      .eq('kind', EVENING_KIND).in('audience_id', fixableIds).gte('last_sent_at', new Date(`${addDaysToDateStr(date, -1)}T00:00:00+03:00`).toISOString());
    for (const r of (rem || []) as Array<{ audience_id: string; last_sent_at: string }>) sentAt.set(r.audience_id, r.last_sent_at);
  }
  const pack = (id: string) => PACK[packKey(byId.get(id)?.group_id)] ?? 1;
  return {
    sentAt: rows.length ? rows.map((r) => r.created_at).sort()[0] : null,
    runners: runners
      .map((r) => ({
        ...r, name: byId.get(r.athleteId)?.name || '', pack: pack(r.athleteId),
        reminder: remindable && fixableIds.includes(r.athleteId) ? sentAt.get(r.athleteId) ?? 'tonight' : null,
      }))
      .sort((a, b) => a.pack - b.pack || a.name.localeCompare(b.name)),
    counts: countsOf(runners),
    noWatch: all.filter((a) => !a.garmin_auth && !appleIds.has(a.id))
      .map((a) => ({ athleteId: a.id, name: a.name || '', pack: pack(a.id) }))
      .sort((a, b) => a.pack - b.pack || a.name.localeCompare(b.name)),
  };
}
