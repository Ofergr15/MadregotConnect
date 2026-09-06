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

/**
 * The shape most of the program is written in, and the one a whole-run average
 * cannot describe: a warm-up at one pace, then the block the session is about.
 * The average of 2 km easy + 10 km at 4:42 is neither number.
 */
const warmupThenBlock = (dayOfWeek: number) => ({
  dayOfWeek,
  name: 'חימום + 10 ק״מ בקצב',
  distanceMinKm: 12,
  distanceMaxKm: 12,
  steps: [
    {
      order: 1,
      type: 'warmup' as const,
      durationType: 'distance' as const,
      durationValue: 2000,
      targetType: 'pace' as const,
      targetPaceMinPerKm: 330,
      targetPaceMaxPerKm: 360,
    },
    {
      order: 2,
      type: 'active' as const,
      durationType: 'distance' as const,
      durationValue: 10000,
      targetType: 'pace' as const,
      targetPaceMinPerKm: 280,
      targetPaceMaxPerKm: 285,
    },
  ],
});

/** What the watch recorded for that session: 2 km at 5:45, then 10 km at 4:42. */
const warmupThenBlockLaps = [
  ...Array.from({ length: 2 }, () => ({ distance: 1000, duration: 345 })),
  ...Array.from({ length: 10 }, () => ({ distance: 1000, duration: 282 })),
];

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

    // athletes + groups + individual plans + shared plans + the executed workouts.
    // Not 12 of anything.
    expect(ops.map(o => o.table).sort()).toEqual(
      ['athlete_activities', 'athletes', 'groups', 'weekly_plans', 'weekly_plans'],
    );
    // And that fifth one asks for the whole page at once, not a row at a time.
    const executed = ops.find(o => o.table === 'athlete_activities')!;
    expect(argOf(executed, 'in')?.[1]).toHaveLength(12);
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

  /**
   * The badge's pace comes from the block the plan was written about, not the run's
   * average. This session's average is 4:53 over 12 km and the plan's 4:40–4:45 band
   * covers 83% of it, which is under the coverage the average path needs — so the old
   * badge had nothing to say about a session that was run exactly as asked.
   */
  describe('block-aligned pace', () => {
    const blockRun = (over: Record<string, unknown> = {}) => run('act-block', FAST, 293, {
      distance: 12000,
      duration: 3510,
      moving_duration: 3510,
      ...over,
    });

    it('grades the block from the laps instead of refusing the average', async () => {
      stubClub({ shared: [{
        week_start_date: '2026-09-06',
        parsed_workouts: { workouts: [warmupThenBlock(3)] },
        created_at: '2026-09-05T00:00:00Z',
      }] });

      const out = await loadFeedPlanVerdicts(supabase, [blockRun({ laps: warmupThenBlockLaps })]);
      expect(out.get('act-block')).toMatchObject({ level: 'on_plan', paceStatus: 'on_target' });
    });

    // Strava's stored laps carry `moving_time`; read as Garmin's `duration` they are
    // all zero-length, and the block grading silently falls back to the average.
    it('reads Strava-shaped laps too', async () => {
      stubClub({ shared: [{
        week_start_date: '2026-09-06',
        parsed_workouts: { workouts: [warmupThenBlock(3)] },
        created_at: '2026-09-05T00:00:00Z',
      }] });

      const out = await loadFeedPlanVerdicts(supabase, [blockRun({
        laps: warmupThenBlockLaps.map((l, i) => ({
          split: i + 1, distance: l.distance, moving_time: l.duration, elapsed_time: l.duration,
        })),
      })]);
      expect(out.get('act-block')?.paceStatus).toBe('on_target');
    });

    // A run synced before laps were stored still gets the badge it always got.
    it('falls back to the whole-run answer when the row has no laps', async () => {
      stubClub({ shared: [{
        week_start_date: '2026-09-06',
        parsed_workouts: { workouts: [warmupThenBlock(3)] },
        created_at: '2026-09-05T00:00:00Z',
      }] });

      const out = await loadFeedPlanVerdicts(supabase, [blockRun()]);
      expect(out.get('act-block')?.paceStatus).toBe('unknown');
    });
  });

  /**
   * When the run came off a structured workout, the badge stops searching the distance
   * axis for the block and reads the step each lap says it was.
   *
   * The case pinned here is the one the search gets WRONG, not merely approximates:
   * this athlete ran a workout of her own — one open 22 km step, with the target in its
   * note — while the club plan for the day is a 2 km warm-up plus a 20 km block. Every
   * lap index still lands inside the plan's step count, so nothing looks amiss; the
   * search lays the plan's blocks over her run and reports the wrong band.
   *
   * The production row this is built from had her own band 5 s/km off the plan's, which
   * the ±10 s/km tolerance now absorbs; her target here is moved out to 4:15–4:25 so the
   * two bands genuinely disagree. Nothing else about the shape changed.
   */
  describe('the watch\'s own step list', () => {
    const ownWorkout = {
      name: 'EZ + intervals',
      createdAt: '2026-09-08T19:00:00.0',
      steps: [
        { stepIndex: 0, intensity: 'ACTIVE', durationType: 'OPEN', notes: '22km - 4:15-4:25' },
        { stepIndex: 1, intensity: 'ACTIVE', durationType: 'TIME', durationSec: 15 },
        { stepIndex: 2, intensity: 'RECOVERY', durationType: 'TIME', durationSec: 45 },
        {
          stepIndex: 3, intensity: null, durationType: 'REPEAT_UNTIL_STEPS_CMPLT',
          repeatFrom: 1, iterations: 8,
        },
      ],
    };
    /** 22 km at 4:22 stamped step 0, then eight strides. */
    const ownLaps = [
      ...Array.from({ length: 22 }, () => ({
        distance: 1000, duration: 262, averagePace: 262, averageHR: null, maxHR: null,
        wktStepIndex: 0,
      })),
      ...Array.from({ length: 8 }, () => [
        { distance: 73, duration: 15, averagePace: 205, averageHR: null, maxHR: null, wktStepIndex: 1 },
        { distance: 70, duration: 45, averagePace: 642, averageHR: null, maxHR: null, wktStepIndex: 2 },
      ]).flat(),
    ];

    const stubWithWorkout = (workout: unknown) => {
      stubClub({ shared: [{
        week_start_date: '2026-09-06',
        parsed_workouts: { workouts: [warmupThenBlock(3)] },
        created_at: '2026-09-05T00:00:00Z',
      }] });
      const club = respond;
      respond = (op) => op.table === 'athlete_activities'
        ? { data: [{ id: 'act-own', executed_workout: workout }], error: null }
        : club(op);
    };

    const ownRun = () => run('act-own', FAST, 262, {
      distance: 22000, duration: 5764, moving_duration: 5764, laps: ownLaps,
    });

    it('grades the step the watch ran, not the block the plan expected', async () => {
      stubWithWorkout(ownWorkout);
      const out = await loadFeedPlanVerdicts(supabase, [ownRun()]);
      // 4:22 against the 4:15–4:25 she wrote herself, in the step's own note.
      expect(out.get('act-own')?.paceStatus).toBe('on_target');
    });

    it('falls back to the search when the run was not driven by a workout', async () => {
      stubWithWorkout(null);
      const out = await loadFeedPlanVerdicts(supabase, [ownRun()]);
      // The plan's 4:40–4:45 block, searched for inside a 22 km run at 4:22 — the
      // wrong band, because it is a workout she did not run.
      expect(out.get('act-own')?.paceStatus).toBe('faster');
    });

    // Migration 095 is applied by hand, so the column may simply not be there yet.
    // The badge must be the one the feed shipped without it, not no badge at all.
    it('falls back to the search when the column is unmigrated', async () => {
      stubClub({ shared: [{
        week_start_date: '2026-09-06',
        parsed_workouts: { workouts: [warmupThenBlock(3)] },
        created_at: '2026-09-05T00:00:00Z',
      }] });
      const club = respond;
      respond = (op) => op.table === 'athlete_activities'
        ? { data: null, error: { message: 'column "executed_workout" does not exist' } }
        : club(op);

      const out = await loadFeedPlanVerdicts(supabase, [ownRun()]);
      expect(out.get('act-own')?.paceStatus).toBe('faster');
    });
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

  // Found on the live data: the only plan for the current week was a `draft`, and
  // it badged 11 of the newest 30 runs — 4 of them a red "off plan" for a week the
  // coach was still editing and nobody had been asked to run.
  it('reads only a published plan, never a draft', async () => {
    stubClub();
    await loadFeedPlanVerdicts(supabase, [run('a', FAST, 282)]);
    const plans = ops.filter(o => o.table === 'weekly_plans');
    expect(plans).toHaveLength(2);
    for (const op of plans) {
      const statuses = op.calls.find(([m, a]) => m === 'in' && a[0] === 'status')?.[1][1];
      expect(statuses).toEqual(['pushed', 'partial']);
    }
  });

  it("scopes the plan reads to the page's athletes", async () => {
    stubClub();
    await loadFeedPlanVerdicts(supabase, [run('a', FAST, 282), run('b', FAST, 282)]);
    const athletes = ops.find(o => o.table === 'athletes')!;
    expect(argOf(athletes, 'in')?.[1]).toEqual([FAST]);
  });
});
