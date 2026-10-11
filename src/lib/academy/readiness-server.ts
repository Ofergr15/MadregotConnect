/**
 * The reads behind the coach's readiness (trainee-experience-v2 C1/C2) and the pause on
 * the pace-up suggestion (coach-tools-build.ts). Server-only; the decisions are
 * readiness-board.ts's, pure.
 *
 * ONE parallel round for any number of trainees: their loads (priced first where missing,
 * at most 100 each and the newest first, so a history still being priced is short of its
 * oldest runs rather than its last month — never stored under view-as), the diary those loads make, 44 mornings
 * of wellness, 28 days of "איך הרגשת?", the race from the characterization call, and the
 * last two days' runs with the season behind them for a record. Before migration 142 the
 * loads come from load-server.ts's in-memory fallback, so the gate still has a form to
 * judge — and a trainee whose numbers are still being learned is never paused on it.
 * Every read that fails reads as "nothing there", never as an error: a missing night or a
 * missing feel must not pause anyone.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { activityLocalDateStr, planWeekStartOf } from '@/lib/utils';
import {
  BACKFILL_DAYS, FAN_OUT, ensureActivityLoads, hasActivityLoadsTable, loadDailyRows, loadTestsFor, mapLimit, plannedLoads, readAll,
  type DailyRow,
} from './load-server';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { DATA_FEED_COLUMNS, DATA_FEED_COLUMNS_FALLBACK, nightFeed, runFeed, type DataFeed } from './data-feed';
import { shiftDate, thresholdOn } from './load';
import { RECORD_DAYS, RECORD_MIN_M } from './records';
import { plannedWeeksFor, type PmcPoint } from './pmc';
import type { WellnessNight } from './normal-range';
import { computeAcademyWeekAdherence } from './report';
import {
  FEEDBACK_DAYS, WELLNESS_DAYS, buildReadinessInputs, recentRecord,
  type FeedbackRow, type ReadinessInputs, type RecordRun,
} from './readiness-board';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/** Activities priced per trainee per read: C1 opens for everyone at once, so less than a screen's 300. */
export const READINESS_MAX_NEW = 100;
export { RECORD_DAYS };
const RECORD_COLUMNS = 'id, athlete_id, start_time, activity_type, distance, duration, laps';

export interface ReadinessRead {
  inputs: ReadinessInputs;
  /** The full PMC (C2 draws 8 weeks of it and projects from its last point). */
  series: PmcPoint[];
  /** The per-activity loads it stands on (C2 needs today's). */
  rows: DailyRow[];
  /** Whether runs are still arriving (data-feed.ts). */
  feed?: DataFeed;
  name: string;
  gender: string | null;
  isAcademy: boolean;
  active: boolean;
}

/** Each trainee's nearest race ahead, from the characterization call (via the candidate row). */
async function loadRaces(db: Db, ids: string[], today: string): Promise<Record<string, { name: string | null; date: string }>> {
  const out: Record<string, { name: string | null; date: string }> = {};
  const { data: cands, error } = await db.from('academy_candidates').select('id, athlete_id').in('athlete_id', ids);
  if (error || !cands?.length) return out;
  const owner = new Map<string, string>((cands as any[]).map(c => [String(c.id), String(c.athlete_id)]));
  const { data: rows, error: cErr } = await db
    .from('academy_characterizations')
    .select('candidate_id, target_race, target_race_date')
    .in('candidate_id', [...owner.keys()]);
  if (cErr || !rows) return out;
  for (const r of rows as any[]) {
    const id = owner.get(String(r.candidate_id));
    const date = r.target_race_date ? String(r.target_race_date).slice(0, 10) : null;
    if (!id || !date || date < today) continue;
    if (!out[id] || date < out[id].date) out[id] = { name: r.target_race ? String(r.target_race).trim() || null : null, date };
  }
  return out;
}

/**
 * A record today or yesterday, per trainee. The season (with its laps) is read only for
 * the trainees who ran in the last two days — on most days that is a handful.
 */
async function loadRecords(db: Db, ids: string[], today: string): Promise<Record<string, { bucket: string; daysAgo: number } | null>> {
  const out: Record<string, { bucket: string; daysAgo: number } | null> = {};
  const { data: recent, error } = await db
    .from('athlete_activities')
    .select(RECORD_COLUMNS)
    .in('athlete_id', ids)
    .gte('start_time', `${shiftDate(today, -2)}T00:00:00Z`);
  if (error || !recent?.length) return out;
  const recentBy = new Map<string, RecordRun[]>();
  for (const r of recent as any[]) {
    const d = activityLocalDateStr(String(r.start_time));
    if (d < shiftDate(today, -1) || d > today) continue;
    const list = recentBy.get(String(r.athlete_id)) ?? [];
    list.push(r as RecordRun);
    recentBy.set(String(r.athlete_id), list);
  }
  const who = [...recentBy.keys()];
  if (!who.length) return out;
  // The whole season of every trainee who ran, paged and totally ordered: one unpaged read
  // across trainees passed the 1,000-row cap and silently dropped a trainee's season best,
  // which made yesterday's slower rep "🏅 a record" on C1. The same distance floor as
  // screen 5's (records.ts RECORD_MIN_M), so the two agree.
  const { data: season, error: sErr } = await readAll<any>((from, to) => db
    .from('athlete_activities')
    .select(RECORD_COLUMNS)
    .in('athlete_id', who)
    .gte('start_time', `${shiftDate(today, -RECORD_DAYS)}T00:00:00Z`)
    .gte('distance', RECORD_MIN_M)
    .order('start_time', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to), 200);
  if (sErr || !season) return out;
  for (const id of who) {
    out[id] = recentRecord(recentBy.get(id) ?? [], (season as any[]).filter(s => String(s.athlete_id) === id) as RecordRun[], today);
  }
  return out;
}

/** The people with their provider columns (before migration 101, without them). */
async function readPeople(db: Db, ids: string[]) {
  const base = 'id, name, gender, is_academy, status';
  for (const cols of [`${base}, ${DATA_FEED_COLUMNS}`, `${base}, ${DATA_FEED_COLUMNS_FALLBACK}`]) {
    const res = await db.from('athletes').select(cols).in('id', ids);
    if (!(res.error && isMissingColumn(res.error))) return res;
  }
  return db.from('athletes').select(base).in('id', ids);
}

/**
 * Readiness for `ids`, as of `today` (an Israel date). `write: false` under view-as: the
 * missing loads are priced in memory and nothing is stored.
 */
export async function loadReadinessInputs(
  db: Db,
  ids: string[],
  today: string,
  opts: { write?: boolean } = {},
): Promise<Record<string, ReadinessRead>> {
  const out: Record<string, ReadinessRead> = {};
  if (!ids.length) return out;
  const write = opts.write ?? true;
  const since = shiftDate(today, -BACKFILL_DAYS);
  const testsP = loadTestsFor(db, ids);

  const safe = <T>(p: PromiseLike<T>, fallback: T, what: string): Promise<T> =>
    Promise.resolve(p).catch((err) => { console.error(`readiness ${what} failed:`, err); return fallback; });

  // The pricing goes first, FAN_OUT trainees at a time (41 side by side, each with its
  // own reads, hung up sockets and gave C1 different numbers on every refresh), then the
  // stored rows are read once. A load read that keeps failing throws: an error on the
  // board, never a number from a different pricing path.
  const has = await hasActivityLoadsTable(db);
  const tests = await testsP;
  const ensured = has
    ? await mapLimit(ids, FAN_OUT, id => safe(
      ensureActivityLoads(db, id, { maxNew: READINESS_MAX_NEW, write, today, tests: tests[id] || [], newestFirst: true }),
      null,
      'load pricing',
    ))
    : ids.map(() => null);
  const [daily, nightsRes, feedbackRes, races, peopleRes, records, planned] = await Promise.all([
    loadDailyRows(db, ids, since, { today }),
    // Paged: 44 mornings × a coach's 41 trainees is past PostgREST's 1,000-row cap, and
    // the rows past it were the NEWEST (a 3-morning RHR streak C2 saw and C1 did not).
    safe(readAll<any>((from, to) => db
      .from('athlete_wellness')
      .select('athlete_id, date, sleep_seconds, resting_hr')
      .in('athlete_id', ids)
      .gte('date', shiftDate(today, -WELLNESS_DAYS))
      .lte('date', today)
      .order('date', { ascending: true })
      .order('athlete_id', { ascending: true })
      .range(from, to)), { data: null, error: true } as any, 'wellness'),
    safe(db
      .from('workout_feedback')
      .select('athlete_id, feel, difficulty, pain, created_at')
      .in('athlete_id', ids)
      .gte('created_at', `${shiftDate(today, -FEEDBACK_DAYS)}T00:00:00Z`), { data: null, error: true } as any, 'feedback'),
    safe(loadRaces(db, ids, today), {}, 'races'),
    safe(readPeople(db, ids), { data: null, error: true } as any, 'people'),
    safe(loadRecords(db, ids, today), {}, 'records'),
    // Each trainee's planned weeks, so the ramp word says "שבוע קל" when the coach planned it.
    mapLimit(ids, FAN_OUT, id => safe(
      plannedLoads(db, id, plannedWeeksFor(today), thresholdOn(today, tests[id] || [])?.thresholdSec ?? null),
      { byWeek: {}, byDate: {} },
      'planned loads',
    )),
  ]);
  const pendingBy = new Map(ids.map((id, k) => [id, ensured[k]?.pending ?? 0]));
  const plannedBy = new Map(ids.map((id, k) => [id, planned[k].byWeek]));

  const fresh = new Map<string, DailyRow>();
  for (const e of ensured) {
    for (const r of e?.rows ?? []) {
      if (r.date >= since) fresh.set(r.activityId, { athleteId: r.athleteId, activityId: r.activityId, date: r.date, load: r.load, source: r.source });
    }
  }
  const rows = daily.rows.filter(r => !fresh.has(r.activityId)).concat([...fresh.values()]);
  const nights = ((nightsRes as any).error ? [] : (nightsRes as any).data || []) as any[];
  const feedback = ((feedbackRes as any).error ? [] : (feedbackRes as any).data || []) as any[];
  const people = new Map<string, any>((((peopleRes as any).error ? [] : (peopleRes as any).data) || []).map((p: any) => [String(p.id), p]));

  const now = Date.now();
  for (const id of ids) {
    const mine = rows.filter(r => r.athleteId === id).sort((a, b) => a.date.localeCompare(b.date));
    const p = people.get(id);
    const feed = runFeed(p ?? null, now);
    const myNights: WellnessNight[] = nights
      .filter(n => String(n.athlete_id) === id)
      .map(n => ({ date: String(n.date).slice(0, 10), sleep_seconds: n.sleep_seconds ?? null, resting_hr: n.resting_hr ?? null }));
    const myFeedback: FeedbackRow[] = feedback.filter(f => String(f.athlete_id) === id);
    const { inputs, series } = buildReadinessInputs({
      rows: mine, nights: myNights, feedback: myFeedback, race: races[id] ?? null, record: records[id] ?? null, today,
      plannedByWeek: plannedBy.get(id),
      gate: { feed, pending: pendingBy.get(id) ?? 0 },
      nightFeed: nightFeed(p ?? null, now),
    });
    out[id] = {
      inputs,
      series,
      rows: mine,
      feed,
      name: String(p?.name ?? ''),
      gender: p?.gender ?? null,
      isAcademy: p ? !!p.is_academy : true,
      active: p ? (p.status ?? 'active') === 'active' : true,
    };
  }
  return out;
}

/**
 * This week's sessions per trainee, done of planned — the adherence the members list and
 * the coach tools' strips grade with (C1's "לפי השבוע", C2's "3 מתוך 5 השבוע").
 */
export async function loadWeekCounts(ids: string[], today: string): Promise<Record<string, { done: number; planned: number }>> {
  const out: Record<string, { done: number; planned: number }> = {};
  if (!ids.length) return out;
  try {
    const report = await computeAcademyWeekAdherence({ weekStart: planWeekStartOf(today), onlyAthleteIds: ids });
    for (const a of report.athletes) out[a.athleteId] = { done: a.week.completedCount, planned: a.week.plannedCount };
  } catch (err) {
    console.error('readiness week counts failed:', err);
  }
  return out;
}
