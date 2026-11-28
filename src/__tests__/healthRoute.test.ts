import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { evaluateHealth, HEALTH_MAX_AGE_MINUTES } from '@/lib/health/evaluate';

/** GET /api/health — DB reachability + ages of the last cron tick and syncs; nothing identifying. */

const NOW = new Date('2026-11-28T10:00:00Z');
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(NOW);
afterAll(() => { vi.useRealTimers(); });

const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

let db: ReturnType<typeof createMemoryDb>;
let throwOnClient = false;
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => { if (throwOnClient) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing'); return db.client; },
}));
const { GET } = await import('@/app/api/health/route');

function seed(withTables = true) {
  db = createMemoryDb({
    schema: withTables
      ? {
          cron_tick_locks: ['tick_at', 'duration_ms'],
          athletes: ['id', 'email', 'garmin_last_sync_at', 'strava_last_sync_at'],
        }
      : {},
  });
}

beforeEach(() => { throwOnClient = false; seed(); });

describe('evaluateHealth', () => {
  const base = { now: NOW, dbReachable: true, lastTickAt: minsAgo(3), lastGarminSyncAt: minsAgo(10), lastStravaSyncAt: minsAgo(30) };

  it('is ok when everything is fresh', () => {
    const r = evaluateHealth(base);
    expect(r.status).toBe('ok');
    expect(r.checks.cron_tick).toEqual({ state: 'ok', ageMinutes: 3, maxAgeMinutes: 20 });
  });

  it('is degraded when a tick is late, exactly at the edge still ok', () => {
    expect(evaluateHealth({ ...base, lastTickAt: minsAgo(HEALTH_MAX_AGE_MINUTES.cron_tick) }).status).toBe('ok');
    const r = evaluateHealth({ ...base, lastTickAt: minsAgo(HEALTH_MAX_AGE_MINUTES.cron_tick + 1) });
    expect(r.status).toBe('degraded');
    expect(r.checks.cron_tick.state).toBe('stale');
  });

  it('does not flag the overnight sync gap (5 h) as stale', () => {
    expect(evaluateHealth({ ...base, lastGarminSyncAt: minsAgo(5 * 60) }).status).toBe('ok');
    expect(evaluateHealth({ ...base, lastGarminSyncAt: minsAgo(7 * 60) }).checks.garmin_sync.state).toBe('stale');
  });

  it('marks a never-stamped job unknown (degraded) and garbage timestamps unknown', () => {
    const r = evaluateHealth({ ...base, lastStravaSyncAt: null, lastTickAt: 'not a date' });
    expect(r.checks.strava_sync.state).toBe('unknown');
    expect(r.checks.cron_tick.state).toBe('unknown');
    expect(r.status).toBe('degraded');
  });

  it('is down when the DB is unreachable, with every job unknown', () => {
    const r = evaluateHealth({ ...base, dbReachable: false });
    expect(r.status).toBe('down');
    expect(r.checks.db.state).toBe('down');
    expect(r.checks.garmin_sync.state).toBe('unknown');
  });

  it('clamps a future timestamp (clock skew) to age 0', () => {
    expect(evaluateHealth({ ...base, lastTickAt: minsAgo(-5) }).checks.cron_tick.ageMinutes).toBe(0);
  });
});

describe('GET /api/health', () => {
  it('reads the newest tick and sync stamps and answers 200 ok', async () => {
    db.tables.cron_tick_locks.push({ tick_at: minsAgo(40) }, { tick_at: minsAgo(4) });
    db.tables.athletes.push(
      { id: uid(), email: 'a@example.test', garmin_last_sync_at: minsAgo(500), strava_last_sync_at: null },
      { id: uid(), email: 'b@example.test', garmin_last_sync_at: minsAgo(6), strava_last_sync_at: minsAgo(25) },
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.checks.cron_tick.ageMinutes).toBe(4);
    expect(body.checks.garmin_sync.ageMinutes).toBe(6);
    expect(body.checks.strava_sync.ageMinutes).toBe(25);
  });

  it('never echoes ids, emails or error text', async () => {
    db.tables.athletes.push({ id: 'athlete-xyz', email: 'secret@example.test', garmin_last_sync_at: minsAgo(1), strava_last_sync_at: minsAgo(1) });
    const text = await (await GET()).text();
    expect(text).not.toMatch(/athlete-xyz|secret@|example\.test/);
  });

  it('is degraded (200) on an empty database', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('degraded');
  });

  it('answers 503 down when every query fails, without the error text', async () => {
    seed(false);
    const res = await GET();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text).status).toBe('down');
    expect(text).not.toMatch(/PGRST|cron_tick_locks|relation/);
  });

  it('answers 503 when the client cannot even be built, without the message', async () => {
    throwOnClient = true;
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/SERVICE_ROLE/);
  });
});
