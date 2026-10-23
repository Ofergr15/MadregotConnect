import type { createServerClient } from '@/lib/supabase/server';

// "It's the cool-down — why did you grade it?" (Ofer 10-23: a 3 km run at 08:03, saved apart
// from the 14 + 7 + 7 that ended 42 minutes before, scored 0%). A short run within 45 minutes
// of a LONGER run the same day is that run's warm-up or cool-down saved on its own — the
// same rule the run page uses to say so (api/activities/analysis `linked`). It is part of the
// session, so it is never graded against the session's plan by itself.

type Db = ReturnType<typeof createServerClient>;
export interface RunRow { id: string; athlete_id: string; start_time: string; duration?: number | null; distance?: number | null }

const MAX_M = 6000;
const GAP_MS = 45 * 60_000;
const ms = (iso: string) => Date.parse(String(iso).slice(0, 19) + 'Z');

/** The pure rule: is `run` the satellite of one of `others`? */
export function isSatellite(run: RunRow, others: RunRow[]): boolean {
  if ((Number(run.distance) || 0) > MAX_M) return false;
  const s = ms(run.start_time); const e = s + (Number(run.duration) || 0) * 1000;
  return others.some((o) => {
    if (o.id === run.id || (o.athlete_id && run.athlete_id && o.athlete_id !== run.athlete_id)) return false;
    if ((Number(o.distance) || 0) <= (Number(run.distance) || 0)) return false;
    const os = ms(o.start_time); const oe = os + (Number(o.duration) || 0) * 1000;
    return (s >= oe - 60_000 && s - oe <= GAP_MS) || (e <= os + 60_000 && os - e <= GAP_MS);
  });
}

/** The ids among `runs` that are satellites, reading each athlete-day's other runs once. */
export async function satelliteIds(db: Db, runs: RunRow[]): Promise<Set<string>> {
  const out = new Set<string>();
  const short = runs.filter((r) => (Number(r.distance) || 0) <= MAX_M && r.start_time);
  if (!short.length) return out;
  const days = new Map<string, RunRow[]>();
  for (const r of short) { const k = `${r.athlete_id}|${String(r.start_time).slice(0, 10)}`; days.set(k, [...(days.get(k) || []), r]); }
  await Promise.all([...days].map(async ([k, rs]) => {
    const [athlete, day] = k.split('|');
    const { data } = await db.from('athlete_activities').select('id, athlete_id, start_time, duration, distance')
      .eq('athlete_id', athlete).gte('start_time', `${day}T00:00:00`).lte('start_time', `${day}T23:59:59`);
    const others = (data || []) as RunRow[];
    for (const r of rs) if (isSatellite(r, others)) out.add(r.id);
  }));
  return out;
}
