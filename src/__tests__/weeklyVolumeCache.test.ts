import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { cachedAthleteWeeks, clearWeeklyVolumeCache, readActivitiesStamp, weeklyVolumeCacheEnabled, weeklyVolumeCacheSize } from '@/lib/athletes/weekly-volume-cache';
import type { fetchWeeklyVolume } from '@/lib/athletes/weekly-volume';
import { MONDAY_WEEK } from '@/lib/utils';

const ON = { WEEKLY_VOLUME_CACHE: '1' };
const A = 'athlete-a';

function db(stamp: string | null | undefined, withColumn = true) {
  const m = createMemoryDb({ schema: { athletes: ['id', ...(withColumn ? ['activities_changed_at'] : [])] } });
  m.tables.athletes.push(withColumn ? { id: A, activities_changed_at: stamp ?? null } : { id: A });
  return m;
}

/** A fake fetchWeeklyVolume that counts calls and returns `km` per week. */
function fakeFetch(km: () => number) {
  return vi.fn((async (_db, o) => {
    const axis = Array.from({ length: o.weeks }, (_, i) => {
      const d = new Date(`${o.currentWeekStart}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (o.weeks - 1 - i) * 7);
      return d.toISOString().slice(0, 10);
    });
    const byAthlete = new Map(o.athleteIds.map((id) => [id, axis.map((weekStart) => ({ weekStart, meters: km() * 1000, runs: 1, seconds: 100, climbM: 0 }))]));
    return { weeks: axis, byAthlete };
  }) as typeof fetchWeeklyVolume);
}

const opts = { athleteId: A, weeks: 4, currentWeekStart: '2026-11-23', startDay: MONDAY_WEEK };

beforeEach(() => clearWeeklyVolumeCache());

describe('weekly volume cache', () => {
  it('is off unless WEEKLY_VOLUME_CACHE=1', () => {
    expect(weeklyVolumeCacheEnabled({})).toBe(false);
    expect(weeklyVolumeCacheEnabled({ WEEKLY_VOLUME_CACHE: 'true' })).toBe(false);
    expect(weeklyVolumeCacheEnabled(ON)).toBe(true);
  });

  it('off: every call reads through and nothing is stored', async () => {
    const f = fakeFetch(() => 10);
    const m = db('2026-11-27T10:00:00Z');
    await cachedAthleteWeeks(m.client, opts, { env: {}, fetch: f });
    await cachedAthleteWeeks(m.client, opts, { env: {}, fetch: f });
    expect(f).toHaveBeenCalledTimes(2);
    expect(weeklyVolumeCacheSize()).toBe(0);
    expect(m.log).toHaveLength(0); // not even the stamp read
  });

  it('on: the second read of the same weeks is a hit', async () => {
    const f = fakeFetch(() => 10);
    const m = db('2026-11-27T10:00:00Z');
    const first = await cachedAthleteWeeks(m.client, opts, { env: ON, fetch: f });
    const second = await cachedAthleteWeeks(m.client, opts, { env: ON, fetch: f });
    expect(f).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(weeklyVolumeCacheSize()).toBe(4);
  });

  it('a fewer-weeks request is served from a longer earlier read', async () => {
    const f = fakeFetch(() => 10);
    const m = db('2026-11-27T10:00:00Z');
    await cachedAthleteWeeks(m.client, { ...opts, weeks: 12 }, { env: ON, fetch: f });
    const short = await cachedAthleteWeeks(m.client, opts, { env: ON, fetch: f });
    expect(f).toHaveBeenCalledTimes(1);
    expect(short.map((b) => b.weekStart)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
  });

  it('a new activity (stamp moves) invalidates: the next read is fresh', async () => {
    let km = 10;
    const f = fakeFetch(() => km);
    const m = db('2026-11-27T10:00:00Z');
    await cachedAthleteWeeks(m.client, opts, { env: ON, fetch: f });
    km = 22;
    m.tables.athletes[0].activities_changed_at = '2026-11-27T10:05:00Z'; // what trigger 270 does
    const after = await cachedAthleteWeeks(m.client, opts, { env: ON, fetch: f });
    expect(f).toHaveBeenCalledTimes(2);
    expect(after[3].meters).toBe(22_000);
  });

  it('a hit returns copies — a caller mutating the result cannot poison the cache', async () => {
    const f = fakeFetch(() => 10);
    const m = db('2026-11-27T10:00:00Z');
    await cachedAthleteWeeks(m.client, opts, { env: ON, fetch: f });
    const hit = await cachedAthleteWeeks(m.client, opts, { env: ON, fetch: f });
    hit[0].meters = -1;
    expect((await cachedAthleteWeeks(m.client, opts, { env: ON, fetch: f }))[0].meters).toBe(10_000);
  });

  it('reads through before migration 270 (no column) and while the stamp is NULL', async () => {
    for (const m of [db(null, false), db(null)]) {
      const f = fakeFetch(() => 10);
      await cachedAthleteWeeks(m.client, opts, { env: ON, fetch: f });
      await cachedAthleteWeeks(m.client, opts, { env: ON, fetch: f });
      expect(f).toHaveBeenCalledTimes(2);
    }
    expect(weeklyVolumeCacheSize()).toBe(0);
  });

  it('keys by athlete: another athlete never gets a cached week', async () => {
    const f = fakeFetch(() => 10);
    const m = db('2026-11-27T10:00:00Z');
    m.tables.athletes.push({ id: 'athlete-b', activities_changed_at: '2026-11-27T10:00:00Z' });
    await cachedAthleteWeeks(m.client, opts, { env: ON, fetch: f });
    await cachedAthleteWeeks(m.client, { ...opts, athleteId: 'athlete-b' }, { env: ON, fetch: f });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('readActivitiesStamp swallows a throw', async () => {
    const bad = { from: () => { throw new Error('down'); } } as never;
    expect(await readActivitiesStamp(bad, A)).toBeNull();
  });
});

describe('migration 270', () => {
  it('is idempotent and covers insert, update and delete', async () => {
    const { readFileSync } = await import('fs');
    const sql = readFileSync('supabase/migrations/270_athlete_activities_changed_at.sql', 'utf8');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS activities_changed_at/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION/);
    for (const op of ['INSERT', 'UPDATE', 'DELETE']) expect(sql).toMatch(new RegExp(`AFTER ${op} ON athlete_activities`));
    expect(sql.match(/DROP TRIGGER IF EXISTS/g)).toHaveLength(3);
  });
});
