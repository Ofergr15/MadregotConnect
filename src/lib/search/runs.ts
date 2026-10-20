import type { createServerClient } from '@/lib/supabase/server';
import { pendingAthleteIds } from '@/lib/auth/pending-athletes';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { containsPattern, quoteFilterValue } from '@/lib/db/like';
import { israelToday } from '@/lib/utils';

type Db = ReturnType<typeof createServerClient>;

// ── runs, by what the workout was ─────────────────────────────────────────────────

export interface RunHit { id: string; athleteId: string; name: string; title: string; date: string; km: number; pace: number | null; mine: boolean }
export interface RunResults {
  /** Today's runs of one workout, folded: "10 × 1600 · 17 ran it from the watch". */
  today: Array<{ title: string; count: number; names: string[]; href: string }>;
  runs: RunHit[];
}
export const EMPTY_RUNS: RunResults = { today: [], runs: [] };

/** "10x1600" / "10*1600" / "10 X 1600" → "10 × 1600", "5000" → "5K": the way the title is stored. */
export function workoutQuery(q: string): string {
  return q.replace(/(\d)\s*[xX×*]\s*(\d)/g, '$1 × $2')
    // Whole kilometres from 3 km up are stored as K ("7 × 5K"), the share card's spelling.
    .replace(/\b(\d+)000\b/g, (m, k) => (Number(k) >= 3 ? `${k}K` : m));
}

/**
 * Runs whose workout ("10 × 1600", athlete_activities.workout_title, migration 165) or name
 * answers the query, the last 120 days: mine first, then the club's. What the feed shows,
 * no more — active members only, not the ones waiting to be let in — and a run that came
 * from Strava only to its owner (Strava's terms: a member's data to that member).
 */
export async function searchRuns(supabase: Db, q: string, caller: { athleteId?: string | null; isStaff?: boolean }): Promise<RunResults> {
  const wq = workoutQuery(q);
  const like = quoteFilterValue(containsPattern(wq));
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
  const cols = 'id, athlete_id, start_time, activity_name, distance, average_pace, garmin_activity_id';
  const run = (withTitle: boolean) => supabase.from('athlete_activities')
    .select(withTitle ? `${cols}, workout_title` : cols)
    .or(withTitle ? `workout_title.ilike.${like},activity_name.ilike.${like}` : `activity_name.ilike.${like}`)
    .gte('start_time', since).order('start_time', { ascending: false }).limit(80);
  let res = await run(true);
  if (res.error && isMissingColumn(res.error, 'workout_title')) res = await run(false);
  if (res.error) return EMPTY_RUNS;
  const rows = (res.data || []) as unknown as Array<{ id: string; athlete_id: string; start_time: string; activity_name: string | null; distance: number | null; average_pace: number | null; garmin_activity_id: number | null; workout_title?: string | null }>;
  if (!rows.length) return EMPTY_RUNS;
  const ids = [...new Set(rows.map((r) => r.athlete_id))];
  const [{ data: people }, pending] = await Promise.all([
    supabase.from('athletes').select('id, name').in('id', ids).eq('status', 'active'),
    pendingAthleteIds(supabase as never).catch(() => new Set<string>()),
  ]);
  const name = new Map(((people || []) as Array<{ id: string; name: string | null }>).map((p) => [p.id, p.name || '']));
  const me = caller.athleteId ?? null;
  const visible = rows.filter((r) => r.athlete_id === me || (name.has(r.athlete_id) && !pending.has(r.athlete_id)
    // A Strava-sourced row stores the negated Strava id: the owner's only.
    && !((r.garmin_activity_id ?? 0) < 0)));
  const today = israelToday();
  const hits: RunHit[] = visible.map((r) => ({
    id: r.id, athleteId: r.athlete_id, name: name.get(r.athlete_id) || '',
    title: r.workout_title || r.activity_name || '', date: String(r.start_time).slice(0, 10),
    km: Math.round((r.distance || 0) / 100) / 10, pace: r.average_pace, mine: r.athlete_id === me,
  }));
  // Today's, by workout: one row for the session the club ran together.
  const groups = new Map<string, RunHit[]>();
  for (const h of hits) if (h.date === today && h.title) groups.set(h.title, [...(groups.get(h.title) || []), h]);
  const folded = [...groups].filter(([, g]) => g.length >= 3)
    .map(([title, g]) => ({ title, count: g.length, names: g.map((x) => x.name.split(' ')[0]).slice(0, 5), href: '/dashboard/quality-session' }));
  const foldedTitles = new Set(folded.map((f) => f.title));
  const rest = hits.filter((h) => h.mine || !(h.date === today && foldedTitles.has(h.title)));
  return { today: folded, runs: [...rest.filter((h) => h.mine), ...rest.filter((h) => !h.mine)].slice(0, 12) };
}
