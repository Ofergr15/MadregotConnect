import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * cron/sync has one deadline for the whole tick. The Garmin pass's 210 s used to be
 * counted from ITS start, so a slow Strava poll before it carried the tick past the
 * 300 s ceiling (504) and everything after the kill — the km snapshot included — was
 * lost. Driven with a fake clock: the Strava poll "takes" 100 s.
 */

const h = vi.hoisted(() => ({ t: 1_000_000, budgets: [] as number[], ran: [] as string[] }));

vi.mock('@/lib/cron-pause', () => ({ cronPaused: async () => false }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q; q.not = () => q; q.is = () => q;
      q.returns = async () => { h.t += 100_000; return { data: [], error: null }; };
      return q;
    },
  }),
}));
vi.mock('@/app/api/garmin/sync-activities/route', () => ({
  runSyncRequest: async (req: Request) => {
    const { budgetMs } = await req.json();
    h.budgets.push(budgetMs);
    h.t += budgetMs;            // uses every millisecond it was given
    h.ran.push('garmin');
    return new Response(JSON.stringify({ synced: 3 }));
  },
}));
vi.mock('@/app/api/strava/sync-activities/route', () => ({ runStravaSyncRequest: async () => new Response('{}') }));
vi.mock('@/lib/strava/poll-rotation', () => ({ stravaPollSlice: () => [], stravaPollTick: () => 0 }));
vi.mock('@/lib/weekly-snapshots', () => ({ snapshotWeeklyKm: async () => { h.ran.push('snapshot'); return {}; } }));
vi.mock('@/lib/strava/backfill-routes', () => ({ backfillStravaRoutes: async () => { h.ran.push('routes'); h.t += 20_000; return { targets: 0 }; } }));
vi.mock('@/lib/strava/backfill-laps', () => ({ backfillStravaLaps: async () => { h.ran.push('laps'); h.t += 20_000; return { attempted: 0 }; } }));
vi.mock('@/lib/garmin/history-schedule', () => ({ runScheduledHistoryBackfill: async () => { h.ran.push('history'); h.t += 20_000; return null; } }));

import { GET, TICK_DEADLINE_MS } from '@/app/api/cron/sync/route';

describe('one deadline for the whole sync tick', () => {
  afterEach(() => vi.restoreAllMocks());

  it('gives Garmin only what the slow Strava poll left, and still writes the km snapshot', async () => {
    h.t = 1_000_000; h.budgets = []; h.ran = [];
    vi.spyOn(Date, 'now').mockImplementation(() => h.t);
    const start = h.t;
    const res = await GET(new Request('http://x/api/cron/sync'));
    const body = await res.json();
    expect(h.budgets[0]).toBeLessThan(210_000);
    expect(h.ran).toContain('snapshot');
    expect(h.ran.indexOf('snapshot')).toBe(h.ran.indexOf('garmin') + 1);
    // Nothing starts after the deadline, so the tick ends inside the 300 s ceiling.
    expect(h.t - start).toBeLessThanOrEqual(TICK_DEADLINE_MS + 20_000);
    expect(h.t - start).toBeLessThan(300_000);
    expect(body.skipped?.length).toBeGreaterThan(0);
  });
});
