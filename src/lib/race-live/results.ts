/**
 * POST-RACE RESULTS DATA (task 179, Valencia 2026-12-06).
 *
 * One finish time per runner on the board, reconciled from two kinds of source:
 *   live      — race_splits 'finish' (manual chip time > organizer feed > LiveTrack > replay)
 *   activity  — the runner's synced run that day (athlete_activities), marathon-length
 *
 * Owner rule: **Garmin wins.** Order when more than one is known:
 *   garmin activity > strava activity > live finish split.
 * A Garmin/Strava pair of the same run is the existing twin rule (lib/activity-dedup.ts,
 * migration 081): the Garmin copy survives, so preferring Garmin here is the same choice.
 * Every source found is returned next to the chosen one, with the gap to the live time, so a
 * watch stopped late (or a chip time typed wrong) is visible rather than silently picked.
 *
 * The pure part (pick + order) is below; the DB read is loadRaceResults().
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanSplits, RACE_M, type Split } from './core';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { activityLocalDateStr, addDaysToDateStr } from '@/lib/utils';
import { RUNS_ONLY_OR } from '@/lib/activities/kinds';

type Db = SupabaseClient<any, any, any>;

export type LiveSource = 'manual' | 'feed' | 'livetrack' | 'replay';
export type ResultSource = 'garmin' | 'strava' | LiveSource;

/** A synced run counts as the race when its distance is within this band of 42.195 km. */
export const ACTIVITY_MIN_M = Math.round(RACE_M * 0.95);
export const ACTIVITY_MAX_M = Math.round(RACE_M * 1.08);

export interface ActivityCandidate {
  id: string;
  source: 'garmin' | 'strava';
  distanceM: number;
  /** Elapsed (wall clock, pauses included) when known, else moving time — a race is timed elapsed. */
  sec: number;
  startTime: string;
}

export interface RunnerResult {
  athleteId: string;
  name: string;
  bib: string | null;
  goalSec: number | null;
  finishSec: number | null;
  source: ResultSource | null;
  live: { sec: number; source: LiveSource } | null;
  activity: { sec: number; source: 'garmin' | 'strava'; activityId: string; distanceM: number } | null;
  /** chosen − live, when both exist (positive = the chosen time is slower than the live one). */
  deltaToLiveSec: number | null;
  /** Live splits that reached the board, for the results page's split table. */
  splits: Split[];
}

/** The race-day activity of one runner: marathon-length runs that day, Garmin before Strava, then the longest. */
export function pickActivity(cands: ActivityCandidate[]): ActivityCandidate | null {
  const ok = cands.filter((c) => c.sec > 0 && c.distanceM >= ACTIVITY_MIN_M && c.distanceM <= ACTIVITY_MAX_M);
  if (!ok.length) return null;
  return [...ok].sort((a, b) => (a.source === b.source ? b.distanceM - a.distanceM : a.source === 'garmin' ? -1 : 1))[0];
}

/** Garmin wins, then Strava, then the live finish split. */
export function reconcile(live: { sec: number; source: LiveSource } | null, activity: ActivityCandidate | null): Pick<RunnerResult, 'finishSec' | 'source' | 'deltaToLiveSec'> {
  if (activity) {
    return { finishSec: activity.sec, source: activity.source, deltaToLiveSec: live ? activity.sec - live.sec : null };
  }
  if (live) return { finishSec: live.sec, source: live.source, deltaToLiveSec: 0 };
  return { finishSec: null, source: null, deltaToLiveSec: null };
}

/** Finishers by time (ties: bib, then name), then everyone without a time by name. */
export function orderResults(rows: RunnerResult[]): RunnerResult[] {
  return [...rows].sort((a, b) => {
    if (a.finishSec !== null && b.finishSec !== null) return a.finishSec - b.finishSec || String(a.bib ?? '').localeCompare(String(b.bib ?? '')) || a.name.localeCompare(b.name);
    if (a.finishSec !== null) return -1;
    if (b.finishSec !== null) return 1;
    return a.name.localeCompare(b.name);
  });
}

function activitySource(r: { garmin_activity_id?: unknown; strava_activity_id?: unknown }): 'garmin' | 'strava' | null {
  if (r.garmin_activity_id !== null && r.garmin_activity_id !== undefined && Number(r.garmin_activity_id) > 0) return 'garmin';
  if (r.strava_activity_id !== null && r.strava_activity_id !== undefined && String(r.strava_activity_id) !== '') return 'strava';
  return null;
}

async function readActivities(db: Db, ids: string[], date: string): Promise<any[]> {
  if (!ids.length) return [];
  // start_time is the runner's local wall clock; take a ±1 day net and match the day exactly below.
  const from = `${addDaysToDateStr(date, -1)}T00:00:00`;
  const to = `${addDaysToDateStr(date, 1)}T23:59:59`;
  const cols = 'id, athlete_id, start_time, distance, duration, garmin_activity_id, strava_activity_id';
  const run = (c: string) => db.from('athlete_activities').select(c).in('athlete_id', ids).or(RUNS_ONLY_OR)
    .gte('start_time', from).lte('start_time', to).limit(1000);
  const first = await run(`${cols}, elapsed_duration`);
  if (!first.error) return first.data || [];
  // 166 not applied: moving time only.
  if (isMissingColumn(first.error, 'elapsed_duration')) return (await run(cols)).data || [];
  return [];
}

/**
 * Results for one race event. Opted-out runners are absent (as on the board), except the viewer's
 * own row. `date` is the event's calendar date (events.date, YYYY-MM-DD).
 */
export async function loadRaceResults(db: Db, eventId: string, viewerId: string | null): Promise<{ date: string | null; runners: RunnerResult[] }> {
  const [{ data: ev }, { data: entries }, { data: splitRows }] = await Promise.all([
    db.from('events').select('date').eq('id', eventId).maybeSingle(),
    db.from('race_entries').select('athlete_id, bib, goal_sec, live_opt_out').eq('event_id', eventId),
    db.from('race_splits').select('athlete_id, point, elapsed_sec, source').eq('event_id', eventId),
  ]);
  const date: string | null = ev?.date ? String(ev.date).slice(0, 10) : null;
  const visible = (entries || []).filter((e: any) => !e.live_opt_out || String(e.athlete_id) === viewerId);
  const ids = visible.map((e: any) => String(e.athlete_id));
  const [{ data: people }, acts] = await Promise.all([
    ids.length ? db.from('athletes').select('id, name').in('id', ids) : Promise.resolve({ data: [] as any[] }),
    date ? readActivities(db, ids, date) : Promise.resolve([] as any[]),
  ]);
  const nameOf = new Map((people || []).map((p: any) => [String(p.id), String(p.name ?? '')]));
  const runners = visible.map((e: any): RunnerResult => {
    const id = String(e.athlete_id);
    const mine = (splitRows || []).filter((r: any) => String(r.athlete_id) === id);
    const splits = cleanSplits(mine.map((r: any) => ({ point: r.point, elapsedSec: r.elapsed_sec })));
    const fin = mine.find((r: any) => r.point === 'finish' && Number(r.elapsed_sec) > 0);
    const live = fin ? { sec: Math.round(Number(fin.elapsed_sec)), source: fin.source as LiveSource } : null;
    const cands: ActivityCandidate[] = acts
      .filter((a: any) => String(a.athlete_id) === id && date && activityLocalDateStr(String(a.start_time)) === date)
      .map((a: any) => ({ a, source: activitySource(a) }))
      .filter((x): x is { a: any; source: 'garmin' | 'strava' } => !!x.source)
      .map(({ a, source }) => ({
        id: String(a.id), source, distanceM: Number(a.distance) || 0, startTime: String(a.start_time),
        sec: Math.round(Number(a.elapsed_duration) > 0 ? Number(a.elapsed_duration) : Number(a.duration) || 0),
      }));
    const act = pickActivity(cands);
    return {
      athleteId: id,
      name: nameOf.get(id) ?? '',
      bib: e.bib ?? null,
      goalSec: e.goal_sec ?? null,
      live,
      activity: act ? { sec: act.sec, source: act.source, activityId: act.id, distanceM: act.distanceM } : null,
      splits,
      ...reconcile(live, act),
    };
  });
  return { date, runners: orderResults(runners) };
}
