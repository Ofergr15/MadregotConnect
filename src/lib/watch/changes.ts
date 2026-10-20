import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import type { ParsedWorkout } from '@/lib/ai/types';
import { splitIntoGroups } from '@/lib/ai/splitGroups';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { withGroupPaces } from '@/lib/plans/watch-paces';
import { paceGroupKeyFor, type PaceGroupKey } from '@/lib/plans/pace-group';
import { convertToGarminWorkout } from '@/lib/garmin/converter';
import { addDaysToDateStr, israelToday } from '@/lib/utils';
import { readDaySession } from '@/lib/day-session/server';

// ═════════════════════════════════════════════════════════════════════════════
// "לעדכן בשעונים" (mockup watch-update; Ofer, 10-20)
//
// After an edit, what on the watches is now the old version, and whose. Every send
// keeps exactly what it put on each runner's watch (workout_deliveries.workout_data,
// the Garmin workout as sent), so the answer is a comparison: rebuild what would be
// sent to THAT runner now (their own pack's copy, the same steps the senders take)
// and set it beside what was sent. Only future days, only what really differs, and
// only the runners who hold it: the update then re-sends exactly that through the
// existing senders, which delete the old copy off the watch first.
// ═════════════════════════════════════════════════════════════════════════════

type Db = ReturnType<typeof createServerClient>;
type StoredPaceProfile = Parameters<typeof convertToGarminWorkout>[1];

/** Fields Garmin or the sender fill in that say nothing about the workout itself. */
const VOLATILE = new Set(['workoutId', 'ownerId', 'createdDate', 'updatedDate', 'author', 'uploadTimestamp', 'shared', 'consumer', 'atpPlanId', 'workoutProvider', 'workoutSourceId']);

export function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (VOLATILE.has(k)) continue;
      const x = (v as Record<string, unknown>)[k];
      if (x === null || x === undefined) continue;
      // The watch text's spacing and dash style are the converter's, not the coach's:
      // "4:50 – 5:30" and "4:50–5:30" are the same session.
      out[k] = typeof x === 'string' && k === 'description' ? x.replace(/\s*[–—-]\s*/g, '-').replace(/\s+/g, ' ').trim() : stable(x);
    }
    return out;
  }
  return v;
}

/** Pure: is what would go now the same as what went? */
export function sameOnWatch(now: unknown, sent: unknown): boolean {
  return JSON.stringify(stable(now)) === JSON.stringify(stable(sent));
}

export interface WatchChangeDay {
  key: string;
  dayOfWeek: number;
  date: string;
  /** Runners whose watch holds the previous version of this day. */
  stale: string[];
}
export interface WatchChanges { days: WatchChangeDay[]; staleAthletes: string[] }

interface Row { athlete_id: string; workout_key: string | null; workout_date: string; workout_data: unknown; created_at: string }
interface Athlete { id: string; group_id: string | null; groups: { pace_profile?: unknown } | null }

async function packs(db: Db) {
  const { data: groups } = await db.from('groups').select('id, pace_profile').eq('coach_id', COACH_ID);
  const sources = (groups || []).map((g: { id: string; pace_profile: { marathonGoal?: number | null } | null }) => ({ id: g.id, marathonGoal: g.pace_profile?.marathonGoal ?? null }));
  return (groupId: string | null | undefined) => paceGroupKeyFor(sources, groupId);
}

/** The newest successful delivery per runner and key, and those runners. */
async function lastDelivered(db: Db, filter: { planId?: string; key?: string }, fromDate: string) {
  let q = db.from('workout_deliveries').select('athlete_id, workout_key, workout_date, workout_data, created_at')
    .eq('status', 'success').gte('workout_date', fromDate);
  q = filter.planId ? q.eq('plan_id', filter.planId) : q.is('plan_id', null).eq('workout_key', filter.key!);
  const { data } = await q.order('created_at', { ascending: false }).limit(2000);
  const latest = new Map<string, Row>();
  for (const r of (data || []) as Row[]) {
    const k = `${r.athlete_id}|${r.workout_key}`;
    if (!latest.has(k)) latest.set(k, r);
  }
  const ids = [...new Set([...latest.values()].map((r) => r.athlete_id))];
  const { data: people } = ids.length
    ? await db.from('athletes').select('id, group_id, groups!group_id(pace_profile)').in('id', ids)
    : { data: [] as Athlete[] };
  return { latest, people: (people || []) as unknown as Athlete[] };
}

function compare(
  latest: Map<string, Row>, people: Athlete[],
  workoutsFor: (a: Athlete) => ParsedWorkout[], dateOf: (w: ParsedWorkout) => string,
): WatchChanges {
  const byKey = new Map<string, WatchChangeDay>();
  for (const a of people) {
    const profile = (a.groups?.pace_profile || {}) as StoredPaceProfile;
    for (const w of workoutsFor(a)) {
      const key = w.workoutKey;
      if (!key) continue;
      const row = latest.get(`${a.id}|${key}`);
      if (!row || (row.workout_data as { queued?: boolean } | null)?.queued) continue;
      const now = convertToGarminWorkout(w, profile, { paceTarget: false });
      if (sameOnWatch(now, row.workout_data)) continue;
      const day = byKey.get(key) ?? { key, dayOfWeek: w.dayOfWeek, date: dateOf(w), stale: [] };
      day.stale.push(a.id);
      byKey.set(key, day);
    }
  }
  const days = [...byKey.values()].sort((x, y) => x.date.localeCompare(y.date));
  return { days, staleAthletes: [...new Set(days.flatMap((d) => d.stale))] };
}

/** The club week: which of its days, from today on, are the old version on whose watch. */
export async function planWatchChanges(planId: string, db: Db = createServerClient(), from?: string): Promise<WatchChanges> {
  const { data: plan } = await db.from('weekly_plans').select('parsed_workouts, week_start_date, athlete_id').eq('id', planId).maybeSingle();
  if (!plan || plan.athlete_id) return { days: [], staleAthletes: [] };
  const stored = plan.parsed_workouts as Record<string, { workouts?: ParsedWorkout[] }> & { workouts?: ParsedWorkout[] };
  // `from`: only for checking the comparison against past sends; the screens never pass it.
  const today = from ?? israelToday();
  const { latest, people } = await lastDelivered(db, { planId }, today);
  if (!people.length) return { days: [], staleAthletes: [] };
  const packOf = await packs(db);
  const grouped = stored && 'group1' in stored;
  const base = normalizeWorkoutParts({ workouts: (grouped ? stored.group1?.workouts : stored?.workouts) ?? [] }).workouts as ParsedWorkout[];
  const weekStart = String(plan.week_start_date);
  const r = compare(latest, people, (a) => {
    const own = grouped ? stored[packOf(a.group_id) as PaceGroupKey]?.workouts : null;
    return withGroupPaces(normalizeWorkoutParts({ workouts: own?.length ? own : base }).workouts, stored) as ParsedWorkout[];
  }, (w) => addDaysToDateStr(weekStart, w.dayOfWeek));
  const days = r.days.filter((d) => d.date >= today);
  return { days, staleAthletes: [...new Set(days.flatMap((d) => d.stale))] };
}

/** A one-day session: is it the old version on whose watch. */
export async function dayWatchChanges(date: string, db: Db = createServerClient()): Promise<WatchChanges> {
  if (date < israelToday()) return { days: [], staleAthletes: [] };
  const { session: s } = await readDaySession(date);
  if (!s) return { days: [], staleAthletes: [] };
  const key = `day:${date}`;
  const { latest, people } = await lastDelivered(db, { key }, date);
  if (!people.length) return { days: [], staleAthletes: [] };
  const packOf = await packs(db);
  const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
  const base = normalizeWorkoutParts({ workouts: [{ dayOfWeek, name: s.title || 'אימון', steps: s.steps }] }).workouts as ParsedWorkout[];
  const split = splitIntoGroups({ workouts: base });
  return compare(latest, people, (a) => {
    const own = split[packOf(a.group_id)]?.workouts ?? base;
    // The day's delivery rows carry the session's own key, whatever key the planner shape made.
    return (withGroupPaces(normalizeWorkoutParts({ workouts: own }).workouts, split) as ParsedWorkout[]).map((w) => ({ ...w, workoutKey: key }));
  }, () => date);
}
