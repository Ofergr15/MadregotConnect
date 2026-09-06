import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_ACADEMY_SETTINGS } from '@/lib/academy/settings';

/**
 * The feed's accuracy ring resolves a whole page of runs against their days' plans.
 *
 * What's worth pinning is the part a refactor could silently get wrong on screen:
 * that it really is a FIXED number of queries for the page (an N+1 here would look
 * identical and cost twenty round trips on the app's landing page), that each
 * athlete is graded against their OWN pace lane rather than whichever bucket comes
 * first in the blob (the false "slower than target" the segments route once
 * produced), that an individual plan beats the club-wide one, that a score is only
 * ever computed for the person looking, and that anything going wrong costs the
 * feed nothing at all.
 */

// loadAcademySettings builds its own client from env; the tolerances are the only
// thing this module wants from it.
vi.mock('@/lib/academy/settings-server', () => ({
  loadAcademySettings: () => Promise.resolve(DEFAULT_ACADEMY_SETTINGS),
}));

type Op = { table: string; calls: Array<[string, unknown[]]> };
let ops: Op[] = [];

const argOf = (op: Op, method: string) => op.calls.find(([m]) => m === method)?.[1];

let respond: (op: Op) => { data: unknown[] | null; error: unknown } = () => ({ data: [], error: null });

function chainFor(record: Op) {
  return new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(respond(record)).then(resolve, reject);
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return () => {
          const { data, error } = respond(record);
          return Promise.resolve({ data: (data || [])[0] ?? null, error });
        };
      }
      return (...args: unknown[]) => {
        record.calls.push([prop as string, args]);
        return chainFor(record);
      };
    },
  });
}

const supabase = {
  from(table: string) {
    const record: Op = { table, calls: [] };
    ops.push(record);
    return chainFor(record);
  },
} as never;

const { loadFeedPlanVerdicts } = await import('@/lib/feed/plan-verdicts');
type Viewer = Parameters<typeof loadFeedPlanVerdicts>[2];

/** A coach on the club page: grades everyone, because that is the job. */
const STAFF: Viewer = { athleteId: 'coach-athlete-id', isStaff: true };

/**
 * Most cases here are about GRADING, so they read as a coach. Who may see a score
 * is its own concern and has its own cases at the bottom.
 */
const load = (rows: Parameters<typeof loadFeedPlanVerdicts>[1], viewer: Viewer = STAFF) =>
  loadFeedPlanVerdicts(supabase, rows, viewer);

const FAST = 'aaaaaaaa-0000-0000-0000-000000000001';
const SLOW = 'aaaaaaaa-0000-0000-0000-000000000002';

/**
 * A 10 km steady run at 4:40–4:45 for group 1, with group 2 and 3 a lane slower
 * each. A single pace covering the whole session is what makes the whole-run
 * average fair to grade (computeGradedPaceBand), which is what the badge reports.
 */
const steadyRun = (dayOfWeek: number) => ({
  dayOfWeek,
  name: '10 ק״מ רצף',
  distanceMinKm: 10,
  distanceMaxKm: 10,
  steps: [{
    order: 1,
    type: 'active' as const,
    durationType: 'distance' as const,
    durationValue: 10000,
    targetType: 'pace' as const,
    targetPaceMinPerKm: 280,
    targetPaceMaxPerKm: 285,
    group2Pace: { min: 300, max: 305 },
    group3Pace: { min: 320, max: 325 },
  }],
});

/** One synced run: 10 km, and whatever average pace the test wants to grade. */
const run = (id: string, athleteId: string, averagePace: number, over: Record<string, unknown> = {}) => ({
  id,
  athlete_id: athleteId,
  activity_type: 'running',
  start_time: '2026-09-09T06:00:00Z', // Wednesday of the week starting 2026-09-06
  distance: 10000,
  duration: Math.round(10 * averagePace),
  moving_duration: Math.round(10 * averagePace),
  average_pace: averagePace,
  ...over,
});

/** Both athletes, one in group 1 and one in group 3, plus the shared club plan. */
function stubClub(over: { shared?: unknown[]; indiv?: unknown[] } = {}) {
  respond = (op) => {
    if (op.table === 'athletes') {
      return { data: [{ id: FAST, group_id: 'g1' }, { id: SLOW, group_id: 'g3' }], error: null };
    }
    if (op.table === 'groups') {
      // resolveGroup reads these names — the club's own naming, not a placeholder.
      return { data: [{ id: 'g1', name: 'Group A - SUB 2:30' }, { id: 'g3', name: 'Group C' }], error: null };
    }
    if (op.table === 'weekly_plans') {
      // The individual query filters by athlete_id; the shared one by `is`.
      const isIndividual = op.calls.some(([m, a]) => m === 'in' && a[0] === 'athlete_id');
      return {
        data: (isIndividual ? over.indiv : over.shared) ?? (isIndividual ? [] : [{
          week_start_date: '2026-09-06',
          parsed_workouts: { workouts: [steadyRun(3)] },
          created_at: '2026-09-05T00:00:00Z',
        }]),
        error: null,
      };
    }
    return { data: [], error: null };
  };
}

beforeEach(() => { ops = []; });

describe('loadFeedPlanVerdicts', () => {
  it('grades a page of runs in a fixed number of queries, whatever its size', async () => {
    stubClub();
    const page = Array.from({ length: 12 }, (_, i) => run(`act-${i}`, i % 2 ? SLOW : FAST, 282));
    await load(page);

    // athletes + groups + individual plans + shared plans + laps. Not 12 of anything.
    expect(ops.map(o => o.table).sort()).toEqual(
      ['athlete_activities', 'athletes', 'groups', 'weekly_plans', 'weekly_plans'],
    );
  });

  it('grades each athlete against their own pace lane', async () => {
    stubClub();
    // 4:42/km: on target for group 1 (4:40–4:45), far too fast for group 3 (5:20–5:25).
    const out = await load([
      run('act-fast', FAST, 282),
      run('act-slow', SLOW, 282),
    ]);

    expect(out.get('act-fast')).toMatchObject({ status: 'graded', score: 100, direction: 'on_target' });
    expect(out.get('act-slow')).toMatchObject({ status: 'graded', direction: 'too_fast' });
    // Same run, same watch — the lane is the only difference, so the score has to
    // move with it or the ring is grading everyone against group 1.
    expect(out.get('act-slow')!.score!).toBeLessThan(100);
  });

  it("prefers the athlete's own plan over the club-wide one", async () => {
    stubClub({
      indiv: [{
        athlete_id: FAST,
        week_start_date: '2026-09-06',
        // Individual plan asks for 5:20, which the club plan never mentions.
        parsed_workouts: {
          workouts: [{ ...steadyRun(3), name: 'אישי', steps: [{
            ...steadyRun(3).steps[0], targetPaceMinPerKm: 320, targetPaceMaxPerKm: 325,
          }] }],
        },
        created_at: '2026-09-05T00:00:00Z',
      }],
    });

    const out = await load([run('act-fast', FAST, 282)]);
    expect(out.get('act-fast')).toMatchObject({ workoutName: 'אישי', direction: 'too_fast' });
  });

  it('takes the newest of duplicate plans for the same week', async () => {
    stubClub({
      shared: [
        {
          week_start_date: '2026-09-06',
          parsed_workouts: { workouts: [{ ...steadyRun(3), name: 'newest' }] },
          created_at: '2026-09-05T00:00:00Z',
        },
        {
          week_start_date: '2026-09-06',
          parsed_workouts: { workouts: [{ ...steadyRun(3), name: 'older' }] },
          created_at: '2026-09-01T00:00:00Z',
        },
      ],
    });
    const out = await load([run('act-fast', FAST, 282)]);
    expect(out.get('act-fast')?.workoutName).toBe('newest');
  });

  it('says nothing about a day with no planned workout', async () => {
    // The plan covers Wednesday (day 3) only; this run is on the Sunday.
    const out = await load([
      run('act-sun', FAST, 282, { start_time: '2026-09-06T06:00:00Z' }),
    ]);
    expect(out.size).toBe(0);
  });

  // A running plan grades runs. "Closest to planned distance" once let a ride win.
  it('never grades a ride against a running plan', async () => {
    stubClub();
    const out = await load([
      run('act-ride', FAST, 282, { activity_type: 'cycling' }),
    ]);
    expect(out.size).toBe(0);
    // And it doesn't even ask the DB when the page has no runs on it.
    expect(ops).toHaveLength(0);
  });

  // Ran 14 km of a 10 km plan, at the pace asked for. Not a failure, and not a
  // pass either — the ring says which way it went rather than averaging the two
  // into a number with no direction attached.
  it('reports running further than asked as its own direction', async () => {
    stubClub();
    const out = await load([
      run('act-long', FAST, 282, { distance: 14000, duration: 3948, moving_duration: 3948 }),
    ]);
    expect(out.get('act-long')).toMatchObject({ status: 'graded', direction: 'too_long' });
    expect(out.get('act-long')!.score!).toBeLessThan(100);
  });

  // The feed is the app's landing page: a plan read that fails must cost it the
  // badge and nothing else.
  it('returns an empty map rather than throwing when a query fails', async () => {
    respond = (op) => op.table === 'weekly_plans'
      ? { data: null, error: { message: 'boom' } }
      : { data: [], error: null };
    await expect(load([run('act-fast', FAST, 282)]))
      .resolves.toEqual(new Map());
  });

  it("returns an empty map when the club has no plans for the page's weeks", async () => {
    stubClub({ shared: [], indiv: [] });
    const out = await load([run('act-fast', FAST, 282)]);
    expect(out.size).toBe(0);
  });

  it('asks for exactly the weeks the page spans, once each', async () => {
    stubClub();
    await load([
      run('a', FAST, 282, { start_time: '2026-09-09T06:00:00Z' }),
      run('b', FAST, 282, { start_time: '2026-09-10T06:00:00Z' }), // same week
      run('c', FAST, 282, { start_time: '2026-09-16T06:00:00Z' }), // next week
    ]);
    const plans = ops.filter(o => o.table === 'weekly_plans');
    for (const op of plans) {
      const weeks = op.calls.find(([m, a]) => m === 'in' && a[0] === 'week_start_date')?.[1][1];
      expect(weeks).toEqual(['2026-09-06', '2026-09-13']);
    }
  });

  it("scopes the plan reads to the page's athletes", async () => {
    stubClub();
    await load([run('a', FAST, 282), run('b', FAST, 282)]);
    const athletes = ops.find(o => o.table === 'athletes')!;
    expect(argOf(athletes, 'in')?.[1]).toEqual([FAST]);
  });

  // ── Whose score is it ────────────────────────────────────────────────────
  // An accuracy percentage is a score on a named person, so it is graded FOR the
  // viewer rather than graded once and hidden at render time. The difference is
  // that a teammate's number never enters the response to leak from.

  it('grades a member their own run and says nothing about a teammate\'s', async () => {
    stubClub();
    const out = await load(
      [run('mine', FAST, 282), run('theirs', SLOW, 282)],
      { athleteId: FAST, isStaff: false },
    );
    expect(out.get('mine')).toMatchObject({ status: 'graded' });
    expect(out.has('theirs')).toBe(false);
  });

  it('grades the whole page for staff', async () => {
    stubClub();
    const out = await load([run('mine', FAST, 282), run('theirs', SLOW, 282)], STAFF);
    expect([...out.keys()].sort()).toEqual(['mine', 'theirs']);
  });

  it('reads nothing at all for a signed-out viewer', async () => {
    stubClub();
    const out = await load([run('mine', FAST, 282)], { athleteId: null, isStaff: false });
    expect(out.size).toBe(0);
    expect(ops).toHaveLength(0);
  });

  // The viewer filter is also the cheap path: a member's club page grades the two
  // runs that are theirs, not the twenty on screen.
  it('only reads laps for the runs it is going to grade', async () => {
    stubClub();
    await load(
      [run('mine', FAST, 282), run('theirs', SLOW, 282)],
      { athleteId: FAST, isStaff: false },
    );
    const laps = ops.find(o => o.table === 'athlete_activities')!;
    expect(argOf(laps, 'in')?.[1]).toEqual(['mine']);
  });
});
