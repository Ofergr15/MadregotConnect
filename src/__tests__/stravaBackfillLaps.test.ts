/**
 * backfillStravaLaps' two load-bearing behaviours: it never exceeds its per-tick
 * budget, and it settles a row Strava has permanently lost.
 *
 * Both matter because the budget is small. Unlike the routes pass, a lap costs
 * 2-3 Strava requests and cannot be batched, so this one takes three rows a tick
 * — which means a single row that fails forever holds a third of every future
 * pass and the 170-row backlog behind it never moves. The 404 branch is the
 * difference between a queue that drains and one that is wedged on its first bad
 * row, and a budget that leaks is a rate limit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Activities Strava will answer for; anything else 404s. */
let known: Map<number, number>;
/** Lap counts `enrichStravaActivity` reports back, by activity id. */
let enrichResult: (id: number) => number | null;
let enrichCalls: number[];
let lapsProbes: number[];
let tokensIssued: number;
/** Set to make every Strava call rate-limit instead of answering. */
let rateLimited = false;

class FakeStravaApiError extends Error {
  constructor(readonly status: number) {
    super(`Strava API error: ${status} - `);
  }
}

vi.mock('@/lib/encryption', () => ({
  decrypt: () => ({ access_token: 'tok', refresh_token: 'ref', expires_at: 4e9 }),
}));

vi.mock('@/lib/strava/client', () => ({
  StravaApiError: FakeStravaApiError,
  stravaErrorStatus: (e: unknown) => (e instanceof FakeStravaApiError ? e.status : null),
  StravaClient: class {
    async getActivityLaps(id: number) {
      lapsProbes.push(id);
      if (rateLimited) throw new FakeStravaApiError(429);
      if (!known.has(id)) throw new FakeStravaApiError(404);
      return [];
    }
  },
}));

vi.mock('@/lib/strava/enrich', () => ({
  getValidStravaToken: async () => {
    tokensIssued++;
    return 'tok';
  },
  enrichStravaActivity: async (
    _supabase: unknown,
    _client: unknown,
    target: { stravaActivityId: number },
  ) => {
    enrichCalls.push(target.stravaActivityId);
    return enrichResult(target.stravaActivityId);
  },
}));

const { backfillStravaLaps, DEFAULT_LAPS_BUDGET } = await import('@/lib/strava/backfill-laps');

interface TargetRow {
  id: string;
  athlete_id: string;
  strava_activity_id: number;
  activity_name: string | null;
  start_time: string | null;
}

/**
 * Supabase stand-in. The target query resolves the rows it is handed, honouring
 * `.limit()` so the budget is actually observable, and reports the full backlog
 * size as `count` the way a `count: 'exact'` select does.
 */
function fakeSupabase(targets: TargetRow[]) {
  const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
  let limit: number | null = null;

  const activities: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'not', 'order']) {
    activities[m] = () => activities;
  }
  activities.limit = (n: number) => {
    limit = n;
    return activities;
  };
  activities.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve({
      data: limit === null ? targets : targets.slice(0, limit),
      error: null,
      count: targets.length,
    }).then(res, rej);
  activities.update = (values: Record<string, unknown>) => ({
    eq: (_col: string, id: string) => {
      updates.push({ id, values });
      return Promise.resolve({ error: null });
    },
  });

  const supabase = {
    from: (table: string) => {
      if (table === 'athletes') {
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'update']) chain[m] = () => chain;
        chain.maybeSingle = async () => ({ data: { strava_auth: 'encrypted' }, error: null });
        return chain;
      }
      return activities;
    },
  };

  return { supabase: supabase as never, updates, limitUsed: () => limit };
}

const row = (n: number, athlete = 'ath-1'): TargetRow => ({
  id: `row-${n}`,
  athlete_id: athlete,
  strava_activity_id: 1000 + n,
  activity_name: `Run ${n}`,
  start_time: `2026-09-0${n}T06:00:00`,
});

beforeEach(() => {
  known = new Map([...Array(9).keys()].map((i) => [1000 + i + 1, 4]));
  enrichResult = () => 4;
  enrichCalls = [];
  lapsProbes = [];
  tokensIssued = 0;
  rateLimited = false;
});

describe('backfillStravaLaps', () => {
  it('costs nothing at all once the backlog is drained', async () => {
    const { supabase, updates } = fakeSupabase([]);
    const result = await backfillStravaLaps(supabase);
    expect(result.attempted).toBe(0);
    // The point of the memo: no Strava client is ever constructed, so a drained
    // backlog is one indexed query per tick rather than a standing quota cost.
    expect(tokensIssued).toBe(0);
    expect(enrichCalls).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('attempts at most the budget, and reports the backlog it did not touch', async () => {
    const { supabase, limitUsed } = fakeSupabase([1, 2, 3, 4, 5, 6, 7].map((n) => row(n)));
    const result = await backfillStravaLaps(supabase);
    expect(limitUsed()).toBe(DEFAULT_LAPS_BUDGET);
    expect(result.attempted).toBe(DEFAULT_LAPS_BUDGET);
    expect(result.filled).toBe(DEFAULT_LAPS_BUDGET);
    // `pending` is the whole backlog, not the slice — it is the number that says
    // whether successive ticks are actually draining it.
    expect(result.pending).toBe(7);
  });

  it('honours a raised budget but caps it, so the staff trigger cannot blow the quota', async () => {
    const many = [...Array(40).keys()].map((i) => row(i + 1));
    const raised = fakeSupabase(many);
    await backfillStravaLaps(raised.supabase, { budget: 10 });
    expect(raised.limitUsed()).toBe(10);

    const absurd = fakeSupabase(many);
    await backfillStravaLaps(absurd.supabase, { budget: 500 });
    expect(absurd.limitUsed()).toBe(25);
  });

  it('refreshes one token per athlete, not one per row', async () => {
    const { supabase } = fakeSupabase([row(1), row(2), row(3)]);
    await backfillStravaLaps(supabase);
    expect(tokensIssued).toBe(1);
  });

  it('counts a run with no breakdown as settled, not as a failure', async () => {
    // Enrichment stores `[]` itself in this case, so there is nothing to write —
    // only the tally distinguishes it from a run that got real laps.
    enrichResult = () => 0;
    const { supabase, updates } = fakeSupabase([row(1)]);
    const result = await backfillStravaLaps(supabase);
    expect(result).toMatchObject({ filled: 0, empty: 1, failed: 0 });
    expect(updates).toHaveLength(0);
  });

  it('settles a row Strava has lost instead of retrying it every tick forever', async () => {
    known.delete(1001);
    enrichResult = (id) => (id === 1001 ? null : 4);
    const { supabase, updates } = fakeSupabase([row(1), row(2), row(3)]);
    const result = await backfillStravaLaps(supabase);

    // `laps: []` is the same "asked, nothing there" a genuinely lapless run gets.
    // Without it this row matches the target query on every future pass, and with
    // a 3-row budget that is a third of the queue permanently spent on a 404.
    expect(updates).toEqual([{ id: 'row-1', values: { laps: [] } }]);
    expect(result).toMatchObject({ empty: 1, filled: 2, failed: 0, rateLimited: false });
    // Only the failing row costs the classification probe.
    expect(lapsProbes).toEqual([1001]);
  });

  it('stops on a rate limit and writes nothing, because the answer is unknown', async () => {
    rateLimited = true;
    enrichResult = () => null;
    const { supabase, updates } = fakeSupabase([row(1), row(2), row(3)]);
    const result = await backfillStravaLaps(supabase);

    expect(result.rateLimited).toBe(true);
    // Stopped on the first row rather than spending the rest of the budget
    // learning the same thing three times.
    expect(result.attempted).toBe(1);
    // And crucially did NOT mark it empty: `laps` NULL already means "unknown",
    // which is exactly what a 429 leaves us with. Marking it would discard a real
    // lap breakdown that Strava still has.
    expect(updates).toHaveLength(0);
  });

  it('does not settle a row that failed for some other reason', async () => {
    // A 500 from Strava, a network blip, a transient decode failure: the row keeps
    // its NULL and is picked up again next pass.
    enrichResult = () => null;
    const { supabase, updates } = fakeSupabase([row(1)]);
    const result = await backfillStravaLaps(supabase);
    expect(result).toMatchObject({ failed: 1, empty: 0, rateLimited: false });
    expect(updates).toHaveLength(0);
  });
});
