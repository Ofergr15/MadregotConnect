/**
 * backfillStravaRoutes' decision table, which is the whole point of the function:
 * four different answers for four different states, where the previous code had
 * one. Getting these wrong is expensive in both directions — writing `false` onto
 * a row that Strava simply did not return this pass erases a map that exists,
 * and rewriting the same `false` every pass re-fires migration 047's
 * route_preview trigger for nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Decodes to three points — the canonical vector from the polyline spec. */
const POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

let stravaActivities: Array<{ id: number; map?: { summary_polyline?: string | null } }> = [];
let clientsCreated = 0;

vi.mock('@/lib/encryption', () => ({
  decrypt: () => ({ access_token: 'tok', refresh_token: 'ref', expires_at: 4e9 }),
}));

vi.mock('@/lib/strava/enrich', () => ({
  getValidStravaToken: async () => 'tok',
}));

vi.mock('@/lib/strava/client', () => ({
  StravaClient: class {
    constructor() {
      clientsCreated++;
    }
    async getAllActivities() {
      return stravaActivities;
    }
  },
}));

const { backfillStravaRoutes } = await import('@/lib/strava/backfill-routes');

interface TargetRow {
  id: string;
  athlete_id: string;
  strava_activity_id: number;
  start_time: string | null;
  has_polyline: boolean | null;
}

/**
 * Supabase stand-in. `athlete_activities` serves the target query when awaited
 * and records patches when `update()`d; `athletes` resolves the roster.
 */
function fakeSupabase(
  targets: TargetRow[],
  athletes: Array<{ id: string; name: string; strava_auth: string | null }>,
) {
  const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
  /** Every filter applied to the target query, as `method(arg, arg…)`. */
  const filters: string[] = [];

  const thenable = (data: unknown, record = false) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'not', 'in', 'returns']) {
      chain[m] = (...args: unknown[]) => {
        if (record) filters.push(`${m}(${args.join(',')})`);
        return chain;
      };
    }
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(res, rej);
    return chain;
  };

  const supabase = {
    from: (table: string) => {
      if (table === 'athletes') return thenable(athletes);
      const chain = thenable(targets, true) as Record<string, unknown>;
      chain.update = (values: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => {
          updates.push({ id, values });
          return Promise.resolve({ error: null });
        },
      });
      return chain;
    },
  };

  return { supabase: supabase as never, updates, filters };
}

const ATHLETE = { id: 'ath-1', name: 'Shahar Glazner', strava_auth: 'encrypted' };
const row = (over: Partial<TargetRow> = {}): TargetRow => ({
  id: 'row-1',
  athlete_id: 'ath-1',
  strava_activity_id: 100,
  start_time: '2026-05-01T06:00:00',
  has_polyline: true,
  ...over,
});

beforeEach(() => {
  stravaActivities = [];
  clientsCreated = 0;
});

describe('backfillStravaRoutes', () => {
  it('stores the decoded route when Strava has one', async () => {
    stravaActivities = [{ id: 100, map: { summary_polyline: POLYLINE } }];
    const { supabase, updates } = fakeSupabase([row({ has_polyline: false })], [ATHLETE]);

    const result = await backfillStravaRoutes(supabase);

    expect(result).toMatchObject({ targets: 1, repaired: 1, cleared: 0, unreachable: 0 });
    expect(updates).toHaveLength(1);
    expect(updates[0].values.has_polyline).toBe(true);
    expect(updates[0].values.gps_points).toHaveLength(3);
  });

  it('clears the flag when Strava confirms the run has no route', async () => {
    // Treadmill or manual entry. The row claims a map, so the feed reserves space
    // it can never fill — 112 rows were in this state.
    stravaActivities = [{ id: 100, map: { summary_polyline: null } }];
    const { supabase, updates } = fakeSupabase([row({ has_polyline: true })], [ATHLETE]);

    const result = await backfillStravaRoutes(supabase);

    expect(result).toMatchObject({ repaired: 0, cleared: 1, unreachable: 0 });
    expect(updates[0].values).toEqual({ has_polyline: false });
    // gps_points must stay NULL — "no route" and "never fetched" stay distinct.
    expect(updates[0].values).not.toHaveProperty('gps_points');
  });

  it('writes nothing when there is no route and the row already admits it', async () => {
    stravaActivities = [{ id: 100, map: { summary_polyline: null } }];
    const { supabase, updates } = fakeSupabase([row({ has_polyline: false })], [ATHLETE]);

    const result = await backfillStravaRoutes(supabase);

    expect(updates).toHaveLength(0);
    expect(result).toMatchObject({ targets: 1, repaired: 0, cleared: 0, unreachable: 0 });
  });

  it('reports a row Strava never returned as unreachable rather than clearing it', async () => {
    // The row is older than the pages walked, or deleted on Strava. Writing
    // has_polyline:false here would be asserting something we did not learn.
    stravaActivities = [{ id: 999, map: { summary_polyline: POLYLINE } }];
    const { supabase, updates } = fakeSupabase([row({ has_polyline: true })], [ATHLETE]);

    const result = await backfillStravaRoutes(supabase);

    expect(updates).toHaveLength(0);
    expect(result).toMatchObject({ repaired: 0, cleared: 0, unreachable: 1 });
  });

  it('makes no Strava request when nothing needs repair', async () => {
    // The quiet path: this runs on a 5-minute cron, so "drained" has to cost
    // one indexed query and nothing else.
    const { supabase, updates } = fakeSupabase([], [ATHLETE]);

    const result = await backfillStravaRoutes(supabase);

    expect(clientsCreated).toBe(0);
    expect(updates).toHaveLength(0);
    expect(result).toEqual({ targets: 0, repaired: 0, cleared: 0, unreachable: 0, results: [] });
  });

  it('reports an athlete who has disconnected Strava instead of throwing', async () => {
    const { supabase, updates } = fakeSupabase(
      [row(), row({ id: 'row-2', strava_activity_id: 101 })],
      [{ ...ATHLETE, strava_auth: null }],
    );

    const result = await backfillStravaRoutes(supabase);

    expect(clientsCreated).toBe(0);
    expect(updates).toHaveLength(0);
    expect(result.unreachable).toBe(2);
    expect(result.results[0].error).toMatch(/No Strava authorisation/);
  });

  it('does not re-ask about runs already recorded as having no route', async () => {
    // The efficiency bug the first production run exposed: 57 rows were correctly
    // marked has_polyline=false, but still matched the target query, so every
    // 5-minute cron tick re-fetched their athletes' lists to re-learn the same
    // answer. Excluding them is what makes a drained backlog actually free.
    const { supabase, filters } = fakeSupabase([], [ATHLETE]);

    await backfillStravaRoutes(supabase);

    expect(filters).toContain('not(has_polyline,is,false)');
  });

  it('can be forced to revisit cleared rows', async () => {
    const { supabase, filters } = fakeSupabase([], [ATHLETE]);

    await backfillStravaRoutes(supabase, { includeCleared: true });

    expect(filters).not.toContain('not(has_polyline,is,false)');
  });

  it('counts each athlete separately', async () => {
    stravaActivities = [
      { id: 100, map: { summary_polyline: POLYLINE } },
      { id: 200, map: { summary_polyline: POLYLINE } },
    ];
    const { supabase } = fakeSupabase(
      [
        row({ id: 'a', athlete_id: 'ath-1', strava_activity_id: 100, has_polyline: false }),
        row({ id: 'b', athlete_id: 'ath-2', strava_activity_id: 200, has_polyline: false }),
      ],
      [ATHLETE, { id: 'ath-2', name: 'Tal Borenstein', strava_auth: 'encrypted' }],
    );

    const result = await backfillStravaRoutes(supabase);

    expect(result.repaired).toBe(2);
    expect(result.results.map((r) => r.repaired)).toEqual([1, 1]);
    // One client per athlete, not per row.
    expect(clientsCreated).toBe(2);
  });
});
