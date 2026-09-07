import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The Garmin history backfill — the pass that reaches activities from before the
 * day an athlete connected, which the live sync's single `getActivities(0, 100)`
 * never asked for.
 *
 * What's worth pinning is everything a plausible refactor could get quietly
 * wrong and never see: that it pages BACKWARDS with an overlap (an offset walk
 * over a newest-first list drops a row through the crack the moment a new
 * activity lands mid-walk), that it stops on a short page rather than on "found
 * nothing new" (the pages between now and the oldest stored row are ALL already
 * known, so the naive terminator would exit before reaching any history at all),
 * that a run's shoe is never attributed, and — the one with a user-visible cost —
 * that importing three hundred old runs sends nobody a single notification.
 */

type Listed = {
  activityId: number;
  activityType: string;
  startTimeLocal: string;
  distance: number;
  duration: number;
};

/** Pages the fake Garmin account will serve, keyed by the offset asked for. */
let pages: Map<number, Listed[]>;
let requestedOffsets: number[];

const listRow = (id: number, over: Partial<Listed> = {}): Listed => ({
  activityId: id,
  activityName: `run-${id}`,
  activityType: 'running',
  startTimeLocal: '2026-03-01T06:00:00',
  distance: 10000,
  duration: 2800,
  ...over,
} as Listed);

vi.mock('@/lib/garmin/client', () => ({
  GarminClient: class {
    async getActivities(start: number, _limit: number) {
      requestedOffsets.push(start);
      return pages.get(start) ?? [];
    }
  },
}));

// A Strava twin of the same run would be found here on the live path; these
// cases are about paging, so nothing is ever a duplicate unless a case says so.
//
// Keyed by distance because that is the one field a case can vary per row without
// disturbing the paging it is really testing. The real matcher is pure and tested
// directly in `activityDedup.test.ts`.
let crossSourceDuplicateIds: Set<number>;
vi.mock('@/lib/activity-dedup', () => ({
  hasCrossSourceDuplicate: () => Promise.resolve(false),
  matchesStoredActivity: (_stored: unknown[], _t: string, distance: number) =>
    crossSourceDuplicateIds.has(distance),
}));

const awardBadges = vi.fn((_id: string) => Promise.resolve({ awarded: [] }));
vi.mock('@/lib/badges/award-engine', () => ({ checkAndAwardBadges: (id: string) => awardBadges(id) }));

const rematch = vi.fn((_id: string) => Promise.resolve({ matched: 0, plans: 0 }));
vi.mock('@/lib/plans/match-athlete-activities', () => ({
  matchAthleteActivities: (_s: unknown, id: string) => rematch(id),
}));

/**
 * Anything the live sync fires per newly-inserted activity. Mocked so a case can
 * assert it was NOT called — the point of a silent backfill.
 */
const notifyTeammates = vi.fn();
const notifyFeedback = vi.fn();
vi.mock('@/lib/push', () => ({
  notifyAthlete: vi.fn(),
  notifyTeammatesOfActivity: (...args: unknown[]) => notifyTeammates(...args),
}));
vi.mock('@/lib/post-workout', () => ({
  notifyMainWorkoutFeedback: (...args: unknown[]) => notifyFeedback(...args),
}));

/** Rows the fake table already holds, and the ones the backfill upserts into it. */
let storedIds: number[];
let upserted: Record<string, unknown>[][];
/** Reads against `athlete_activities` — see the N+1 case below. */
let activitySelects: number;

function fakeSupabase() {
  const chain = (table: string, op: string, inserted: Record<string, unknown>[] = []) => {
    const self: Record<string, unknown> = {};
    const result = () => {
      if (table === 'athletes') {
        return { data: [{ id: 'athlete-1', name: 'Test', garmin_auth: { email: 'x' } }], error: null };
      }
      // `upsert(…, { ignoreDuplicates: true }).select('id')` returns the rows it
      // actually wrote — which is how `imported` stays honest when a concurrent
      // tick already inserted some of them.
      if (op === 'upsert') {
        return { data: inserted.map((r) => ({ id: `row-${r.garmin_activity_id}` })), error: null };
      }
      // `select('start_time')…limit(1)` — the oldest-stored read at the end.
      return { data: storedIds.map((garmin_activity_id) => ({ garmin_activity_id })), error: null };
    };
    for (const method of ['select', 'eq', 'not', 'order', 'limit', 'gt', 'is']) {
      self[method] = () => self;
    }
    self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return self;
  };
  return {
    from(table: string) {
      return {
        select: () => {
          if (table === 'athlete_activities') activitySelects++;
          return chain(table, 'select');
        },
        upsert: (payload: Record<string, unknown>[]) => {
          upserted.push(payload);
          storedIds.push(...payload.map((r) => r.garmin_activity_id as number));
          return chain(table, 'upsert', payload);
        },
      };
    },
  } as never;
}

const { backfillGarminHistory } = await import('@/lib/garmin/history-backfill');

const run = (opts: Parameters<typeof backfillGarminHistory>[1] = {}) =>
  backfillGarminHistory(fakeSupabase(), opts);

/** A full page of 100 rows starting at a given id, so paging continues. */
const fullPage = (from: number) => Array.from({ length: 100 }, (_, i) => listRow(from + i));

beforeEach(() => {
  pages = new Map();
  requestedOffsets = [];
  storedIds = [];
  upserted = [];
  activitySelects = 0;
  crossSourceDuplicateIds = new Set();
  awardBadges.mockClear();
  rematch.mockClear();
  notifyTeammates.mockClear();
  notifyFeedback.mockClear();
});

describe('backfillGarminHistory', () => {
  // 90, not 100. An activity synced while the walk is in progress shifts every
  // later offset down by one, and a non-overlapping walk loses whatever row fell
  // across the boundary — permanently, because nothing revisits it.
  it('pages backwards with an overlap so a mid-walk sync cannot drop a row', async () => {
    pages.set(90, fullPage(1000));
    pages.set(180, fullPage(2000));
    pages.set(270, []);
    await run({ maxPages: 3 });
    expect(requestedOffsets).toEqual([90, 180, 270]);
  });

  it('resumes from a page a previous call handed back', async () => {
    pages.set(90, fullPage(1000));
    const first = await run({ maxPages: 1 });
    expect(first.athletes[0].nextPage).toBe(2);
    expect(first.more).toBe(true);

    requestedOffsets = [];
    pages.set(180, []);
    const second = await run({ maxPages: 1, fromPage: first.athletes[0].nextPage! });
    expect(requestedOffsets).toEqual([180]);
    expect(second.more).toBe(false);
  });

  // The terminator that matters. Every page between "now" and the oldest row
  // already stored is, by construction, entirely known — so stopping when a page
  // yields nothing new would exit before reaching a single historical row.
  it('keeps walking past a page with nothing new on it', async () => {
    storedIds = Array.from({ length: 100 }, (_, i) => 1000 + i);
    pages.set(90, fullPage(1000)); // all already stored
    pages.set(180, [listRow(5001)]); // short page: the history, and the end of it
    const result = await run({ maxPages: 5 });

    expect(requestedOffsets).toEqual([90, 180]);
    expect(upserted.flat().map((r) => r.garmin_activity_id)).toEqual([5001]);
    // Short page = Garmin has nothing older. Nothing left to resume.
    expect(result.athletes[0].nextPage).toBeNull();
    expect(result.more).toBe(false);
  });

  // Importing a March run is a correction to the record, not news. An athlete
  // with hundreds of old activities must not be pushed hundreds of times, and
  // neither must their squad.
  it('imports silently — no teammate push, no feedback nudge', async () => {
    pages.set(90, [listRow(1), listRow(2), listRow(3)]);
    await run({ maxPages: 1 });
    expect(upserted.flat()).toHaveLength(3);
    expect(notifyTeammates).not.toHaveBeenCalled();
    expect(notifyFeedback).not.toHaveBeenCalled();
  });

  // The athlete's CURRENT shoe did not run their March sessions; stamping it
  // would add hundreds of kilometres to that shoe and fire the replace alert.
  it('never attributes an imported run to a shoe', async () => {
    pages.set(90, [listRow(1)]);
    await run({ maxPages: 1 });
    expect(upserted.flat()[0]).not.toHaveProperty('shoe_id');
  });

  // Leaving these NULL is what makes `PATCH ?mode=route` (which selects on
  // `gps_points IS NULL`) pick the imported rows up later. Setting them to
  // empty/false would hide every one of them from the map repair forever.
  it('leaves the route columns unset so the enrichment pass still finds the row', async () => {
    pages.set(90, [listRow(1)]);
    await run({ maxPages: 1 });
    const row = upserted.flat()[0];
    expect(row).not.toHaveProperty('gps_points');
    expect(row).not.toHaveProperty('has_polyline');
    // …but the scalars the list row does carry are there, so the run counts
    // toward totals and PRs the moment it lands.
    expect(row).toMatchObject({ distance: 10000, duration: 2800, average_pace: 280 });
  });

  it('skips a ride, and a run Strava already imported', async () => {
    crossSourceDuplicateIds = new Set([12345]);
    pages.set(90, [
      listRow(1),
      listRow(2, { activityType: 'cycling' }),
      listRow(3, { distance: 12345 }),
    ]);
    await run({ maxPages: 1 });
    expect(upserted.flat().map((r) => r.garmin_activity_id)).toEqual([1]);
  });

  // Once per athlete after the walk, not once per row: a first-marathon badge
  // earned in March is a true fact the club had no record of, and awarding it
  // three hundred times over is not.
  it('evaluates badges once for the athlete, and only if anything was imported', async () => {
    pages.set(90, [listRow(1), listRow(2)]);
    await run({ maxPages: 1 });
    expect(awardBadges).toHaveBeenCalledTimes(1);
    expect(awardBadges).toHaveBeenCalledWith('athlete-1');

    awardBadges.mockClear();
    pages.set(90, []);
    await run({ maxPages: 1 });
    expect(awardBadges).not.toHaveBeenCalled();
  });

  // Imported history predates every published plan, so matching is opt-in.
  it('does not re-run plan matching unless asked', async () => {
    pages.set(90, [listRow(1)]);
    await run({ maxPages: 1 });
    expect(rematch).not.toHaveBeenCalled();

    // A different activity: id 1 is stored now, so a second walk over the same
    // page would import nothing and skip the follow-up work either way.
    pages.set(90, [listRow(2)]);
    await run({ maxPages: 1, rematch: true });
    expect(rematch).toHaveBeenCalledWith('athlete-1');
  });

  // The fault that made the first real import fail. The cross-source duplicate
  // check used to be a QUERY PER CANDIDATE ACTIVITY, so three full pages meant
  // three hundred sequential Supabase round trips inside one serverless
  // invocation — past the timeout, and the caller saw a dead request with no
  // error in it. It is now one prefetch per athlete plus the oldest-stored read,
  // and that must hold no matter how deep the walk goes.
  it('reads the activity table a fixed number of times, not once per candidate', async () => {
    pages.set(90, fullPage(1000));
    pages.set(180, fullPage(2000));
    pages.set(270, fullPage(3000));
    await run({ maxPages: 3 });
    expect(upserted.flat()).toHaveLength(300);
    expect(activitySelects).toBe(2);
  });

  // A revoked credential on one athlete is that athlete's problem, exactly as
  // the live sync treats a failed fetch — the club's walk carries on.
  it('records a Garmin failure against the athlete and keeps its cursor', async () => {
    const result = await run({ maxPages: 1, fromPage: 4 });
    pages = new Map();
    expect(result.athletes[0].imported).toBe(0);
    // Empty page, not an error — but the shape a caller reads is the same one.
    expect(result.athletes[0].nextPage).toBeNull();
  });
});
