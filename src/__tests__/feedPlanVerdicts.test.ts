import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_ACADEMY_SETTINGS } from '@/lib/academy/settings';

/**
 * The feed's plan badge resolves a whole page of runs against their days' plans.
 *
 * What's worth pinning is the part a refactor could silently get wrong on screen:
 * that it really is a FIXED number of queries for the page (an N+1 here would look
 * identical and cost twenty round trips on the app's landing page), that each
 * athlete is graded against their OWN pace lane rather than whichever bucket comes
 * first in the blob (the false "slower than target" the segments route once
 * produced), that an individual plan beats the club-wide one, and that anything
 * going wrong costs the feed nothing at all.
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
    await loadFeedPlanVerdicts(supabase, page);

    // athletes + groups + individual plans + shared plans. Not 12 of anything.
    expect(ops.map(o => o.table).sort()).toEqual(
      ['athletes', 'groups', 'weekly_plans', 'weekly_plans'],
    );
  });

  it('grades each athlete against their own pace lane', async () => {
    stubClub();
    // 4:42/km: on target for group 1 (4:40–4:45), far too fast for group 3 (5:20–5:25).
    const out = await loadFeedPlanVerdicts(supabase, [
      run('act-fast', FAST, 282),
      run('act-slow', SLOW, 282),
    ]);

    expect(out.get('act-fast')).toMatchObject({ level: 'on_plan', paceStatus: 'on_target' });
    expect(out.get('act-slow')).toMatchObject({ paceStatus: 'faster' });
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

    const out = await loadFeedPlanVerdicts(supabase, [run('act-fast', FAST, 282)]);
    expect(out.get('act-fast')).toMatchObject({ workoutName: 'אישי', paceStatus: 'faster' });
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
    const out = await loadFeedPlanVerdicts(supabase, [run('act-fast', FAST, 282)]);
    expect(out.get('act-fast')?.workoutName).toBe('newest');
  });

  it('says nothing about a day with no planned workout', async () => {
    // The plan covers Wednesday (day 3) only; this run is on the Sunday.
    const out = await loadFeedPlanVerdicts(supabase, [
      run('act-sun', FAST, 282, { start_time: '2026-09-06T06:00:00Z' }),
    ]);
    expect(out.size).toBe(0);
  });

  // A running plan grades runs. "Closest to planned distance" once let a ride win.
  it('never grades a ride against a running plan', async () => {
    stubClub();
    const out = await loadFeedPlanVerdicts(supabase, [
      run('act-ride', FAST, 282, { activity_type: 'cycling' }),
    ]);
    expect(out.size).toBe(0);
    // And it doesn't even ask the DB when the page has no runs on it.
    expect(ops).toHaveLength(0);
  });

  it('reports over-distance separately from off-pace, for the badge to colour', async () => {
    stubClub();
    const out = await loadFeedPlanVerdicts(supabase, [
      run('act-long', FAST, 282, { distance: 14000, duration: 3948, moving_duration: 3948 }),
    ]);
    expect(out.get('act-long')).toMatchObject({ distanceStatus: 'over', paceStatus: 'on_target' });
  });

  // The feed is the app's landing page: a plan read that fails must cost it the
  // badge and nothing else.
  it('returns an empty map rather than throwing when a query fails', async () => {
    respond = (op) => op.table === 'weekly_plans'
      ? { data: null, error: { message: 'boom' } }
      : { data: [], error: null };
    await expect(loadFeedPlanVerdicts(supabase, [run('act-fast', FAST, 282)]))
      .resolves.toEqual(new Map());
  });

  it("returns an empty map when the club has no plans for the page's weeks", async () => {
    stubClub({ shared: [], indiv: [] });
    const out = await loadFeedPlanVerdicts(supabase, [run('act-fast', FAST, 282)]);
    expect(out.size).toBe(0);
  });

  it('asks for exactly the weeks the page spans, once each', async () => {
    stubClub();
    await loadFeedPlanVerdicts(supabase, [
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
    await loadFeedPlanVerdicts(supabase, [run('a', FAST, 282), run('b', FAST, 282)]);
    const athletes = ops.find(o => o.table === 'athletes')!;
    expect(argOf(athletes, 'in')?.[1]).toEqual([FAST]);
  });
});
