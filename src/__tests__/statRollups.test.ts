import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { createMemoryDb } from './helpers/memory-db';
import {
  profileRollupsEnabled, readProfileRollups, refreshStaleRollups, rollupsFresh, rollupsToTotals, type RollupRow,
} from '@/lib/athletes/stat-rollups';
import { buildAllTimeTotals, buildMonthTotals, buildYearTotals } from '@/lib/athletes/profile-stats';
import { filterQualifyingRuns } from '@/lib/prs/pr-buckets';

const ON = { PROFILE_STAT_ROLLUPS: '1' };
const TODAY = '2026-11-28';
const A = 'athlete-a';

// A fixture club year: what the SQL function would write, computed here with the JS rule.
const acts = [
  { id: '1', start_time: '2026-11-03T06:00:00', distance: 10_000, duration: 3000, activity_type: 'running' },
  { id: '2', start_time: '2026-11-27T23:30:00', distance: 21_100, duration: 6600, activity_type: 'running' },
  { id: '3', start_time: '2026-01-01T00:30:00', distance: 5_000, duration: 1500, activity_type: null },
  { id: '4', start_time: '2025-12-31T23:50:00', distance: 8_000, duration: 2600, activity_type: 'running' },
  { id: '5', start_time: '2026-11-10T07:00:00', distance: 30_000, duration: 4000, activity_type: 'cycling' },
  { id: '6', start_time: '2026-11-11T07:00:00', distance: 0, duration: 100, activity_type: 'running' },
];
function rowsFromActs(computedAt: string): RollupRow[] {
  const by = new Map<string, { meters: number; seconds: number; runs: number }>();
  for (const a of filterQualifyingRuns(acts)) {
    for (const p of ['all', a.start_time.slice(0, 4), a.start_time.slice(0, 7)]) {
      const b = by.get(p) ?? { meters: 0, seconds: 0, runs: 0 };
      b.meters += a.distance; b.seconds += a.duration; b.runs += 1; by.set(p, b);
    }
  }
  return [...by].map(([period, b]) => ({ period, ...b, computed_at: computedAt }));
}

describe('rollupsToTotals agrees with the JS folds', () => {
  it('all-time, year and month match buildAllTimeTotals / buildYearTotals / buildMonthTotals', () => {
    const t = rollupsToTotals(rowsFromActs('2026-11-28T00:00:00Z'), TODAY)!;
    expect(t.allTime).toEqual(buildAllTimeTotals(acts));
    expect(t.year).toEqual(buildYearTotals(acts, 2026));
    expect(t.month).toEqual(buildMonthTotals(acts, TODAY));
  });

  it('numeric strings (PostgREST numeric) are read as numbers; no "all" row is null', () => {
    const t = rollupsToTotals([{ period: 'all', meters: '42195', seconds: '10800', runs: '1', computed_at: 'x' }], TODAY)!;
    expect(t.allTime).toEqual({ totalKm: 42, totalRuns: 1, totalHours: 3 });
    expect(t.year.yearKm).toBe(0);
    expect(rollupsToTotals([], TODAY)).toBeNull();
  });
});

describe('freshness', () => {
  const rows = rowsFromActs('2026-11-28T10:00:00Z');
  it('fresh when computed at/after the last change, stale before, never without a stamp', () => {
    expect(rollupsFresh(rows, '2026-11-28T10:00:00Z')).toBe(true);
    expect(rollupsFresh(rows, '2026-11-28T10:00:01Z')).toBe(false);
    expect(rollupsFresh(rows, null)).toBe(false);
    expect(rollupsFresh([], '2026-11-28T09:00:00Z')).toBe(false);
  });
});

function db(opts: { rollups?: RollupRow[]; stamp?: string | null; tables?: boolean } = {}) {
  const m = createMemoryDb({
    schema: opts.tables === false ? {} : {
      athlete_stat_rollups: ['athlete_id', 'period', 'meters', 'seconds', 'runs', 'computed_at'],
      athletes: ['id', 'activities_changed_at'],
    },
  });
  if (opts.tables !== false) {
    m.tables.athletes.push({ id: A, activities_changed_at: opts.stamp ?? null });
    for (const r of opts.rollups ?? []) m.tables.athlete_stat_rollups.push({ athlete_id: A, ...r });
  }
  return m;
}

describe('readProfileRollups', () => {
  it('off by default: no query at all', async () => {
    const m = db({ rollups: rowsFromActs('2026-11-28T10:00:00Z'), stamp: '2026-11-28T09:00:00Z' });
    expect(profileRollupsEnabled({})).toBe(false);
    expect(await readProfileRollups(m.client, A, TODAY, {})).toBeNull();
    expect(m.log).toHaveLength(0);
  });

  it('on + fresh: the totals', async () => {
    const m = db({ rollups: rowsFromActs('2026-11-28T10:00:00Z'), stamp: '2026-11-28T09:00:00Z' });
    expect((await readProfileRollups(m.client, A, TODAY, ON))?.allTime).toEqual(buildAllTimeTotals(acts));
  });

  it('on + stale (a run landed after the refresh): null, the route folds from activities', async () => {
    const m = db({ rollups: rowsFromActs('2026-11-28T10:00:00Z'), stamp: '2026-11-28T10:05:00Z' });
    expect(await readProfileRollups(m.client, A, TODAY, ON)).toBeNull();
  });

  it('on, migrations not pasted: null', async () => {
    expect(await readProfileRollups(db({ tables: false }).client, A, TODAY, ON)).toBeNull();
  });
});

describe('refreshStaleRollups', () => {
  it('off: null, no RPC', async () => {
    const rpc = vi.fn();
    expect(await refreshStaleRollups({ rpc } as never, {})).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('on: one RPC with the PR run types, never throws', async () => {
    const rpc = vi.fn(async () => ({ data: 3, error: null }));
    expect(await refreshStaleRollups({ rpc } as never, ON)).toEqual({ refreshed: 3 });
    expect(rpc).toHaveBeenCalledWith('refresh_stale_athlete_stat_rollups', expect.objectContaining({ p_limit: 50 }));
    const bad = { rpc: async () => ({ data: null, error: { message: 'function does not exist' } }) };
    expect(await refreshStaleRollups(bad as never, ON)).toEqual({ error: 'function does not exist' });
    const thrower = { rpc: () => { throw new Error('down'); } };
    expect(await refreshStaleRollups(thrower as never, ON)).toEqual({ error: 'down' });
  });
});

describe('migration 271', () => {
  const sql = readFileSync('supabase/migrations/271_athlete_stat_rollups.sql', 'utf8').replace(/--.*$/gm, '');
  it('is idempotent, service-role only, and never reads weekly_km_snapshots', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS athlete_stat_rollups/);
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2);
    expect(sql).toMatch(/REVOKE ALL ON athlete_stat_rollups FROM anon, authenticated/);
    expect(sql).not.toMatch(/FROM\s+weekly_km_snapshots/i);
    expect(sql).toMatch(/AT TIME ZONE 'UTC'/);
  });
});
