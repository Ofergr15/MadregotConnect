import type { createServerClient } from '@/lib/supabase/server';
import { loadQualityWorkout } from '@/lib/quality-session/server';

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

/** The quality session's name for a day, or null when the day has none. Never throws. */
async function nameOfDay(db: Db, date: string): Promise<string | null> {
  try {
    const { data } = await db.from('day_sessions').select('title, quality, published_at')
      .eq('session_date', date).maybeSingle();
    const ds = data as { title?: string | null; quality?: boolean | null; published_at?: string | null } | null;
    if (ds?.published_at && ds.quality === true && ds.title?.trim()) return ds.title.trim();
  } catch { /* no day session table: the plan answers */ }
  try {
    const q = await loadQualityWorkout(db, date);
    return q?.name?.trim() || null;
  } catch {
    return null;
  }
}

/** activity id -> the quality session's name, for the runs that take one. */
export async function qualityNames(db: Db, runs: NamedRun[], maxDays = 14): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const pick = longestPerDay(runs);
  const days = [...new Set(pick.values())].sort().reverse().slice(0, maxDays);
  const names = new Map<string, string | null>(await Promise.all(days.map(async (d) => [d, await nameOfDay(db, d)] as const)));
  for (const [id, day] of pick) {
    const n = names.get(day);
    if (n) out.set(id, n);
  }
  return out;
}
