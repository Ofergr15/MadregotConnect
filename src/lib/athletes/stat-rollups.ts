import type { createServerClient } from '@/lib/supabase/server';
import { PR_RUN_TYPES } from '@/lib/prs/pr-buckets';
import type { AllTimeTotals, MonthTotals, YearTotals } from './profile-stats';

/**
 * Precomputed profile totals (migration 271, design in docs/profile-rollups.md), behind
 * `PROFILE_STAT_ROLLUPS=1` — default off, and off means nothing here runs.
 *
 * The sync refreshes every athlete whose activities changed since their rollup
 * (`refreshStaleRollups`, one RPC). The profile reads them (`readProfileRollups`) and uses them
 * only when they are fresh — `computed_at` at or after `athletes.activities_changed_at`
 * (migration 270). Stale, missing, or any error → null, and the route folds the totals from the
 * activities exactly as before. Never from weekly_km_snapshots (CLAUDE.md).
 */

type Db = ReturnType<typeof createServerClient>;
type Env = Record<string, string | undefined>;

export function profileRollupsEnabled(env: Env = process.env): boolean {
  return env.PROFILE_STAT_ROLLUPS === '1';
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface RollupRow { period: string; meters: number | string; seconds: number | string; runs: number | string; computed_at: string }

export interface ProfileRollups { allTime: AllTimeTotals; year: YearTotals; month: MonthTotals }

/** Pure: rows → the same three shapes buildAllTimeTotals / buildYearTotals / buildMonthTotals return. */
export function rollupsToTotals(rows: RollupRow[], todayIso: string): ProfileRollups | null {
  const by = new Map(rows.map((r) => [r.period, r]));
  const all = by.get('all');
  if (!all) return null;
  const n = (v: number | string | undefined) => Number(v) || 0;
  const year = todayIso.slice(0, 4);
  const month = todayIso.slice(0, 7);
  return {
    allTime: { totalKm: Math.round(n(all.meters) / 1000), totalRuns: n(all.runs), totalHours: round1(n(all.seconds) / 3600) },
    year: { year: Number(year), yearKm: Math.round(n(by.get(year)?.meters) / 1000), yearRuns: n(by.get(year)?.runs) },
    month: { monthKm: round1(n(by.get(month)?.meters) / 1000), monthRuns: n(by.get(month)?.runs), monthDay: Number(todayIso.slice(8, 10)) },
  };
}

/** Pure: fresh only when every row was computed at or after the last activity change. */
export function rollupsFresh(rows: RollupRow[], activitiesChangedAt: string | null): boolean {
  if (!rows.length || !activitiesChangedAt) return false;
  const changed = Date.parse(activitiesChangedAt);
  return rows.every((r) => Date.parse(r.computed_at) >= changed);
}

export async function readProfileRollups(db: Db, athleteId: string, todayIso: string, env: Env = process.env): Promise<ProfileRollups | null> {
  if (!profileRollupsEnabled(env)) return null;
  try {
    const year = todayIso.slice(0, 4);
    const month = todayIso.slice(0, 7);
    const [rollups, athlete] = await Promise.all([
      db.from('athlete_stat_rollups').select('period, meters, seconds, runs, computed_at')
        .eq('athlete_id', athleteId).in('period', ['all', year, month]),
      db.from('athletes').select('activities_changed_at').eq('id', athleteId).maybeSingle(),
    ]);
    if (rollups.error || athlete.error) return null;
    const rows = (rollups.data || []) as RollupRow[];
    const stamp = (athlete.data as { activities_changed_at?: string | null } | null)?.activities_changed_at ?? null;
    if (!rollupsFresh(rows, stamp)) return null;
    return rollupsToTotals(rows, todayIso);
  } catch {
    return null;
  }
}

/** The sync's call. Returns athletes refreshed, or an error string; never throws. */
export async function refreshStaleRollups(db: Db, env: Env = process.env): Promise<{ refreshed: number } | { error: string } | null> {
  if (!profileRollupsEnabled(env)) return null;
  try {
    const { data, error } = await db.rpc('refresh_stale_athlete_stat_rollups', { p_run_types: [...PR_RUN_TYPES], p_limit: 50 });
    if (error) return { error: error.message };
    return { refreshed: Number(data) || 0 };
  } catch (e) {
    return { error: String((e as Error)?.message || e) };
  }
}
