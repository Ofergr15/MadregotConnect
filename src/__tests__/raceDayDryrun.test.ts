import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { formatReport, percentile, rng, runDryRun, type DryRunTransport } from '@/lib/race-live/dryrun';

/**
 * Task 146: the race-day dry run, in-process. 25 runners post every 20 s for 4 h through the REAL
 * position route, 10 viewers read the REAL board route every 30 s, on a fake clock against the
 * in-memory DB. The same scenario runs over HTTP against a local server with scripts/race-day-dryrun.mts.
 */

const EVENT = uid();
const RUNNERS = Array.from({ length: 25 }, () => uid());
const VIEWERS = Array.from({ length: 10 }, () => uid());

const caller = { current: null as string | null };
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => ({
    denied: null,
    caller: { athleteId: caller.current, isStaff: false, isSuperUser: false, role: 'runner', email: 'x' },
  }),
}));
vi.mock('@/lib/features/server', () => ({ isFeatureEnabled: async () => true }));
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const { POST } = await import('@/app/api/race-live/[eventId]/position/route');
const { GET: BOARD } = await import('@/app/api/race-live/[eventId]/route');

const START = Date.parse('2026-12-06T07:15:00Z');
const ctx = { params: Promise.resolve({ eventId: EVENT }) };

function seed() {
  db = createMemoryDb({
    schema: {
      race_live_config: ['event_id', 'source', 'active', 'last_polled_at', 'poll_from', 'poll_to'],
      race_entries: ['event_id', 'athlete_id', 'bib', 'live_opt_out', 'goal_sec', 'livetrack_url', 'livetrack_state'],
      race_splits: ['event_id', 'athlete_id', 'point', 'elapsed_sec', 'source'],
      race_positions: ['event_id', 'athlete_id', 'lat', 'lon', 'distance_m', 'elapsed_sec', 'at'],
      race_map_viewers: ['event_id', 'athlete_id'],
      athletes: ['id', 'name', 'avatar_url'],
      event_group_assignments: ['event_id', 'athlete_id', 'group_id'],
    },
    unique: { race_positions: [['event_id', 'athlete_id']], race_map_viewers: [['event_id', 'athlete_id']] },
  });
  db.tables.race_live_config.push({ event_id: EVENT, source: 'manual', active: true, last_polled_at: null, poll_from: '2026-12-06T06:45:00Z', poll_to: '2026-12-06T13:45:00Z' });
  RUNNERS.forEach((id, i) => {
    db.tables.race_entries.push({ event_id: EVENT, athlete_id: id, bib: String(1000 + i), live_opt_out: false, goal_sec: 12600 });
    db.tables.athletes.push({ id, name: `Runner ${i}`, avatar_url: null });
  });
  VIEWERS.forEach((id, i) => {
    db.tables.athletes.push({ id, name: `Fan ${i}`, avatar_url: null });
    db.tables.race_map_viewers.push({ event_id: EVENT, athlete_id: id });
  });
}

const transport: DryRunTransport = {
  async postPosition(i, body) {
    caller.current = RUNNERS[i];
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as any, ctx);
    return { status: res.status, body: await res.json() };
  },
  async getBoard(v) {
    caller.current = VIEWERS[v];
    const res = await BOARD(new Request('http://x') as any, ctx);
    return { status: res.status, body: await res.json() };
  },
};
const fakeClock = { advanceTo: (ms: number) => { vi.setSystemTime(ms); } };

beforeEach(() => {
  seed();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

describe('race-day dry run (in-process, 25 runners × 20 s × 4 h)', () => {
  it('no errors, no unexpected 429s, every runner on the board, tracks match', async () => {
    const report = await runDryRun(transport, fakeClock, { startMs: START });
    // Visible in the test output, so a run doubles as the numbers for docs/race-day-dryrun.md.
    console.log(formatReport(report));
    expect(report.errors).toBe(0);
    expect(report.unexpectedRateLimited).toBe(0);
    expect(report.rejected).toEqual({});
    // ~25 × 720 posts (minus the restart gaps and runners who finished and stopped sharing).
    expect(report.posts.count).toBeGreaterThan(25 * 500);
    expect(report.posts.byStatus['200']).toBe(report.posts.count);
    expect(report.boards.count).toBe(10 * 480);
    expect(report.boards.byStatus['200']).toBe(report.boards.count);
    // A continuously sharing phone's track IS the phone's distance.
    expect(report.maxTrackErrorM).toBeLessThanOrEqual(1);
    // A restarted phone loses only its offline stretch (180 s at ≤ 4:00/km ≈ 760 m), never the whole track.
    expect(report.maxRestartTrackErrorM).toBeGreaterThan(0);
    expect(report.maxRestartTrackErrorM).toBeLessThan(1200);
    expect(db.tables.race_positions).toHaveLength(25);
    expect(formatReport(report)).toContain('RESULT: PASS');
  }, 120_000);

  it('intended double sends are 429 and counted apart from unexpected ones', async () => {
    const report = await runDryRun(transport, fakeClock, { startMs: START, runners: 5, durationSec: 1800, viewers: 1, doubleSendRate: 0.2 });
    expect(report.retriesSent).toBeGreaterThan(0);
    expect(report.expectedRateLimited).toBe(report.retriesSent);
    expect(report.unexpectedRateLimited).toBe(0);
    expect(report.posts.byStatus['429']).toBe(report.retriesSent);
  });

  it('a cadence under the 8 s server limit shows up as unexpected 429s → FAIL', async () => {
    const report = await runDryRun(transport, fakeClock, { startMs: START, runners: 2, durationSec: 600, viewers: 0, cadenceSec: 5, jitterSec: 0, restarts: 0 });
    expect(report.unexpectedRateLimited).toBeGreaterThan(0);
    expect(formatReport(report)).toContain('RESULT: FAIL');
  });

  it('a closed race window is reported as rejections, not as success', async () => {
    db.tables.race_live_config[0].poll_to = '2026-12-06T07:30:00Z';
    const report = await runDryRun(transport, fakeClock, { startMs: START, runners: 2, durationSec: 1800, viewers: 0, restarts: 0 });
    expect(report.rejected['out-of-window']).toBeGreaterThan(0);
    expect(formatReport(report)).toContain('RESULT: FAIL');
  });

  it('a 5xx or a thrown request is an error', async () => {
    const broken: DryRunTransport = {
      postPosition: async (i) => { if (i === 0) throw new Error('ECONNREFUSED'); return { status: 500, body: { error: 'save failed' } }; },
      getBoard: async () => ({ status: 200, body: {} }),
    };
    const report = await runDryRun(broken, fakeClock, { startMs: START, runners: 2, durationSec: 60, viewers: 0, restarts: 0, startSpreadSec: 0 });
    expect(report.errors).toBe(report.posts.count);
    expect(report.posts.byStatus.network).toBeGreaterThan(0);
    expect(report.firstErrors[0]).toMatch(/ECONNREFUSED|500/);
  });
});

describe('helpers', () => {
  it('percentile is nearest-rank', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile([], 95)).toBeNull();
  });
  it('rng is deterministic per seed', () => {
    const a = rng(1), b = rng(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
