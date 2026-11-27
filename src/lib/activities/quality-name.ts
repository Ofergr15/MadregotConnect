import type { createServerClient } from '@/lib/supabase/server';
import { loadQualityWorkout } from '@/lib/quality-session/server';
import { RUNS_ONLY_OR } from '@/lib/activities/kinds';

// The name a QUALITY session's run goes under (Ofer, 2026-10-18: "like Strava — only the
// quality sessions by the coach's name"). On a day the club has a quality session — the
// plan's quality workout (lib/quality-session/server.ts), or a one-day session the coach
// marked "אימון איכות" — each runner's longest run that day is called what the coach
// called the workout. Every other run keeps the Strava-style time-of-day name
// (lib/activities/run-name.ts), and a name the runner typed always wins there.

type Db = ReturnType<typeof createServerClient>;

export interface NamedRun { id: string; athlete_id: string; start_time: string; distance?: number | string | null }

/** The runner's wall-clock day (start_time is stored in their own clock). */
const dayOf = (startTime: string) => startTime.slice(0, 10);

/** Pure: which run of each runner's day takes the day's quality name. */
export function longestPerDay(runs: NamedRun[]): Map<string, string> {
  const best = new Map<string, NamedRun>();
  for (const r of runs) {
    const key = `${r.athlete_id}:${dayOf(r.start_time)}`;
    const cur = best.get(key);
    if (!cur || Number(r.distance || 0) > Number(cur.distance || 0)) best.set(key, r);
  }
  return new Map([...best.values()].map((r) => [r.id, dayOf(r.start_time)]));
}

type DaySessionRow = { session_date?: string | null; title?: string | null; quality?: boolean | null; published_at?: string | null };

/** A published one-day session the coach marked quality, by its name. */
function daySessionName(ds: DaySessionRow | undefined): string | null {
  return ds?.published_at && ds.quality === true && ds.title?.trim() ? ds.title.trim() : null;
}

/**
 * The quality session's name for each day, or null when the day has none. Never throws.
 *
 * One `day_sessions` read for every day (it used to be one per day — up to 14 round trips on a
 * feed page); only the days without a quality day session fall through to the plan's workout.
 */
async function namesOfDays(db: Db, days: string[]): Promise<Map<string, string | null>> {
  const byDay = new Map<string, DaySessionRow>();
  try {
    const { data } = await db.from('day_sessions').select('session_date, title, quality, published_at')
      .in('session_date', days);
    for (const r of (Array.isArray(data) ? data : []) as DaySessionRow[]) {
      if (r.session_date && !byDay.has(r.session_date)) byDay.set(r.session_date, r);
    }
  } catch { /* no day session table: the plan answers */ }
  return new Map(await Promise.all(days.map(async (d) => {
    const fromSession = daySessionName(byDay.get(d));
    if (fromSession) return [d, fromSession] as const;
    try {
      const q = await loadQualityWorkout(db, d);
      return [d, q?.name?.trim() || null] as const;
    } catch {
      return [d, null] as const;
    }
  })));
}

/** activity id -> the quality session's name, for the runs that take one. */
export async function qualityNames(db: Db, runs: NamedRun[], maxDays = 14): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const pick = longestPerDay(runs);
  const days = [...new Set(pick.values())].sort().reverse().slice(0, maxDays);
  if (days.length === 0) return out;
  const names = await namesOfDays(db, days);
  for (const [id, day] of pick) {
    const n = names.get(day);
    if (n) out.set(id, n);
  }
  return out;
}

/**
 * Pure: the page's runs plus the rest of the same runners' same days, deduped by id. The longest-run rule must be
 * decided over the whole day, not over whatever a feed page happens to hold: 2026-11-25, a runner's 21 km at 05:28 had
 * dropped off the club page while their 2 km jog at 07:47 was still on it, so the jog took the quality session's name
 * ("שלישי") instead of the run itself.
 */
export function wholeDays(page: NamedRun[], sameDays: NamedRun[]): NamedRun[] {
  const wanted = new Set(page.map((r) => `${r.athlete_id}:${dayOf(r.start_time)}`));
  const byId = new Map(page.map((r) => [r.id, r]));
  for (const r of sameDays) if (wanted.has(`${r.athlete_id}:${dayOf(r.start_time)}`) && !byId.has(r.id)) byId.set(r.id, r);
  return [...byId.values()];
}

/** `qualityNames` for a feed page: decided over each runner's whole day, answered for the page's runs only. Never throws. */
export async function qualityNamesForPage(db: Db, page: NamedRun[]): Promise<Map<string, string>> {
  if (page.length === 0) return new Map();
  let runs = page;
  try {
    const days = page.map((r) => dayOf(r.start_time)).sort();
    const { data, error } = await db.from('athlete_activities').select('id, athlete_id, start_time, distance').or(RUNS_ONLY_OR)
      .in('athlete_id', [...new Set(page.map((r) => r.athlete_id))])
      .gte('start_time', `${days[0]}T00:00:00`).lte('start_time', `${days[days.length - 1]}T23:59:59.999`)
      .limit(1000);
    if (!error && data) runs = wholeDays(page, data as NamedRun[]);
  } catch { /* the page alone, as before */ }
  const all = await qualityNames(db, runs);
  const ids = new Set(page.map((r) => r.id));
  return new Map([...all].filter(([id]) => ids.has(id)));
}
