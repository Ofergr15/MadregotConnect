import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/**
 * GET /api/academy/week-board — the v2 additions (trainee-experience-v2 screen 2): the ⚡
 * of every run and every planned session and the two totals, the footer marks (feel,
 * comments with and without Stream, a record), the off-plan line, the rest days, and that
 * every field the coach's screen already reads is still there.
 *
 * The grading engine is mocked (it has its own tests); the loads run for real against the
 * memory database, so the ⚡ here is the number /api/academy/load would print.
 */

const TRAINEE = uid();
const COACH = uid();
const STRANGER = uid();

const israelDay = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// A finished week: the Sunday two weeks back, so nothing in it depends on today.
const today = israelDay();
const thisSunday = addDays(today, -new Date(`${today}T12:00:00Z`).getUTCDay());
const SUN = addDays(thisSunday, -14);
const MON = addDays(SUN, 1);
const TUE = addDays(SUN, 2);
const THU = addDays(SUN, 4);

const caller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: () => caller(),
  requireCallerForAthlete: () => caller(),
}));
vi.mock('@/lib/academy/pairing-server', () => ({
  mayCoach: async (c: { athleteId: string }, id: string) => c.athleteId === id || (c.athleteId === COACH && id === TRAINEE),
}));

const RUN_SUN = uid();
const RUN_MON = uid();
const steps = (metres: number, pace: number) => [{ order: 1, type: 'active', durationType: 'distance', durationValue: metres, targetType: 'pace', targetPaceMinPerKm: pace, targetPaceMaxPerKm: pace }];
const adherenceRow = (o: { date: string; name: string; plannedM: number; actualM: number | null; run?: string; optional?: boolean }) => ({
  date: o.date,
  name: o.name,
  completed: o.actualM != null,
  actual: o.run ? { id: o.run, date: o.date, distance: o.actualM, duration: 3000 } : null,
  distance: { plannedMin: o.plannedM, plannedMax: o.plannedM, actual: o.actualM, status: 'on_target', pct: null },
  duration: { planned: o.plannedM * 0.33, actual: o.actualM != null ? o.actualM * 0.33 : null, estimated: true, status: 'unknown', pct: null },
  pace: { plannedMin: 330, plannedMax: 330, comparedMin: 330, comparedMax: 330, actual: o.actualM != null ? 330 : null, status: 'on_target' },
  score: 1,
  planned: {},
  detail: { workout: { dayOfWeek: 0, name: o.name, steps: steps(o.plannedM, 330), description: null, ...(o.optional ? { optional: true } : {}) }, laps: [], verdict: null, efforts: null },
});
const ROWS = [
  adherenceRow({ date: SUN, name: 'קל 10 ק״מ', plannedM: 10000, actualM: 10000, run: RUN_SUN }),
  adherenceRow({ date: MON, name: 'קל 8 ק״מ', plannedM: 8000, actualM: 6200, run: RUN_MON }),
  adherenceRow({ date: TUE, name: 'קל 6 ק״מ', plannedM: 6000, actualM: null }),
  adherenceRow({ date: THU, name: 'ערב - אופציה', plannedM: 5000, actualM: null, optional: true }),
];
vi.mock('@/lib/academy/report', () => ({
  computeAcademyWeekAdherence: async () => ({ weekStart: SUN, weekEnd: addDays(SUN, 6), tolerances: {}, athletes: [{ athleteId: TRAINEE, name: 'Shahar', week: { workouts: ROWS } }] }),
}));
let basis = { fromClub: false, referenceSec: 252, drawAtSec: 252, scale: 1 };
vi.mock('@/lib/academy/book-server', () => ({
  loadPlanBasis: async () => basis,
  loadThresholds: async () => ({ [TRAINEE]: 252 }),
  loadTraineeWeeks: async () => ({ [TRAINEE]: { planId: 'own' } }),
  loadClubWeek: async () => null,
  loadLaneReferences: async () => ({ 1: 252, 2: 260, 3: 270, 4: 280 }),
}));

let thread: () => Promise<unknown[]>;
vi.mock('@/lib/stream/server', () => ({
  CHANNEL_TYPE: 'messaging',
  getStreamServerClient: () => ({
    queryChannels: async () => [{ state: { messages: await thread() } }],
  }),
}));

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));

const { GET } = await import('@/app/api/academy/week-board/route');
const get = () => GET(new Request(`http://x/api/academy/week-board?athleteId=${TRAINEE}&weekStart=${SUN}`));

const SCHEMA: Record<string, string[]> = {
  athlete_activities: ['id', 'athlete_id', 'garmin_activity_id', 'start_time', 'activity_type', 'distance', 'duration', 'moving_duration', 'average_hr', 'max_hr', 'laps', 'splits'],
  academy_tests: ['id', 'athlete_id', 'test_date', 'protocol', 'duration_sec', 'distance_m', 'excluded_reason', 'status'],
  athlete_wellness: ['athlete_id', 'date', 'resting_hr', 'sleep_seconds'],
  athletes: ['id', 'group_id', 'name', 'academy_coach_id'],
  workout_deliveries: ['athlete_id', 'workout_date', 'status'],
  workout_feedback: ['athlete_id', 'garmin_activity_id', 'feel', 'comment'],
  academy_workout_feedback: ['athlete_id', 'workout_date'],
  activity_loads: ['activity_id', 'athlete_id', 'activity_date', 'load', 'source', 'threshold_sec', 'basis_test_date', 'formula_version', 'computed_at'],
};

const splits = (km: number, pace: number) => Array.from({ length: Math.round(km) }, () => ({ distance: 1000, duration: pace }));
const run = (id: string, date: string, km: number, pace: number, garmin: number | null = null) => ({
  id, athlete_id: TRAINEE, garmin_activity_id: garmin, start_time: `${date}T07:00:00`, activity_type: 'running',
  distance: km * 1000, duration: km * pace, moving_duration: km * pace, average_hr: 150, max_hr: 178, laps: null, splits: splits(km, pace),
});

function seed() {
  db = createMemoryDb({ schema: SCHEMA });
  db.tables.athletes.push({ id: TRAINEE, group_id: null, name: 'Shahar', academy_coach_id: COACH }, { id: COACH, group_id: null, name: 'Sahar Ben Ami', academy_coach_id: null });
  db.tables.academy_tests.push({ id: uid(), athlete_id: TRAINEE, test_date: israelDay(-200), protocol: '30min', duration_sec: 1800, distance_m: 7143, excluded_reason: null, status: 'approved' });
  // 60 days of history (so the load status is ok), every other day, never on the board's days.
  for (let i = 60; i >= 1; i -= 2) {
    const d = israelDay(-i);
    if (d >= SUN && d <= addDays(SUN, 6)) continue;
    db.tables.athlete_activities.push(run(uid(), d, 10, 330));
  }
  // The week: Sunday a faster 10 km (a record), Monday cut to 6.2.
  db.tables.athlete_activities.push(run(RUN_SUN, SUN, 10, 300, 111), run(RUN_MON, MON, 6.2, 340, 222));
  db.tables.workout_feedback.push(
    { athlete_id: TRAINEE, garmin_activity_id: 111, feel: 3, comment: null },
    { athlete_id: TRAINEE, garmin_activity_id: 222, feel: 2, comment: 'קצר בגלל החום' },
  );
  db.tables.academy_workout_feedback.push({ athlete_id: TRAINEE, workout_date: SUN });
}

const as = (athleteId: string, extra: Record<string, unknown> = {}) =>
  caller.mockResolvedValue({ denied: null, caller: { athleteId, isStaff: athleteId !== TRAINEE, isSuperUser: false, role: 'runner', ...extra } });

beforeEach(() => {
  seed();
  as(TRAINEE);
  thread = async () => [
    { id: 'm1', text: 'איך היה?', workout_date: SUN, created_at: '2026-10-01T10:00:00Z' },
    { id: 'm2', text: 'חם מדי', workout_date: MON, created_at: '2026-10-01T11:00:00Z' },
    // The review card is counted from Postgres, never twice.
    { id: 'm3', text: '', workout_date: SUN, academy_feedback: { type: 'academy_feedback', workout_date: SUN }, created_at: '2026-10-01T12:00:00Z' },
    { id: 'm4', text: 'another week', workout_date: addDays(SUN, -7), created_at: '2026-10-01T13:00:00Z' },
  ];
});

describe('who may read it', () => {
  it('is 403 for a stranger', async () => {
    as(STRANGER);
    expect((await get()).status).toBe(403);
  });
  it('is 200 for the trainee and for their coach', async () => {
    expect((await get()).status).toBe(200);
    as(COACH);
    expect((await get()).status).toBe(200);
  });
});

describe('the v2 week', () => {
  it('keeps every field the coach\'s screen reads', async () => {
    const body = await (await get()).json();
    expect(body).toMatchObject({ weekStart: SUN, athlete: { id: TRAINEE, name: 'Shahar' }, coachName: 'Sahar Ben Ami', thresholdSec: 252, fromClub: false });
    expect(body.totals).toMatchObject({ plannedCount: 4, doneCount: 2, plannedKm: 29, doneKm: 16.2 });
    for (const w of body.workouts) {
      expect(w).toEqual(expect.objectContaining({
        date: expect.any(String), dayOfWeek: expect.any(Number), name: expect.any(String), compliance: expect.any(Object),
        plannedM: expect.any(Number), onWatch: false, steps: expect.any(Array),
      }));
    }
  });

  it('prices every run and every planned session; the totals are the week\'s', async () => {
    const body = await (await get()).json();
    const [sun, mon, tue, thu] = body.workouts;
    expect(sun.load).toBeGreaterThan(0);
    expect(mon.load).toBeGreaterThan(0);
    expect(tue.load).toBeNull();
    for (const w of body.workouts) expect(w.plannedLoad).toBeGreaterThan(0);
    expect(body.totals.doneLoad).toBe(sun.load + mon.load);
    // The optional evening run is priced but not part of the week's plan.
    expect(thu.optional).toBe(true);
    const sum = sun.plannedLoad + mon.plannedLoad + tue.plannedLoad;
    expect(Math.abs(body.totals.plannedLoad - sum)).toBeLessThanOrEqual(1);
    expect(body.loadOk).toBe(true);
    // Priced on the way, and stored.
    expect(db.tables.activity_loads.length).toBeGreaterThan(20);
  });

  it('a club week is priced in the trainee\'s paces, not the lane\'s', async () => {
    const own = await (await get()).json();
    // The lane writes its paces for a 4:12 threshold; this trainee's is 5:02 (× 1.2).
    basis = { fromClub: true, referenceSec: 252, drawAtSec: 302, scale: 302 / 252 };
    try {
      const club = await (await get()).json();
      expect(club.fromClub).toBe(true);
      // Restated, the same session is slower: a lower intensity, so less ⚡ per km.
      expect(club.workouts[0].plannedLoad).toBeLessThan(own.workouts[0].plannedLoad);
    } finally {
      basis = { fromClub: false, referenceSec: 252, drawAtSec: 252, scale: 1 };
    }
  });

  it('says how the cut run went, and in the trainee\'s own words', async () => {
    const body = await (await get()).json();
    const [sun, mon, tue] = body.workouts;
    expect(sun.compliance.color).toBe('green');
    expect(sun.offLine).toBeNull();
    expect(mon.compliance).toMatchObject({ color: 'yellow', caret: 'down' });
    expect(mon.offLine).toEqual({ caret: 'down', unit: 'km', actual: '6.2', planned: '8' });
    expect(mon.comment).toBe('קצר בגלל החום');
    expect(tue.compliance.color).toBe('red');
  });

  it('marks only what is true: feel, comments (review + thread), a record', async () => {
    const body = await (await get()).json();
    const [sun, mon, tue] = body.workouts;
    expect(sun.marks).toEqual({ feel: 3, comments: 2, pr: expect.any(String) });
    expect(mon.marks).toEqual({ feel: 2, comments: 1 });
    expect(tue.marks).toEqual({});
  });

  it('with Stream down, the comments are the coach\'s reviews alone, and the week still answers', async () => {
    thread = async () => { throw new Error('stream down'); };
    const res = await get();
    expect(res.status).toBe(200);
    const [sun, mon] = (await res.json()).workouts;
    expect(sun.marks.comments).toBe(1);
    expect(mon.marks.comments).toBeUndefined();
  });

  it('the days with nothing planned come back as rest rows', async () => {
    const body = await (await get()).json();
    expect(body.restDays).toEqual([addDays(SUN, 3), addDays(SUN, 5), addDays(SUN, 6)].map(date => ({ date, rest: true })));
  });

  it('under view-as stores nothing', async () => {
    as(TRAINEE, { viewingAsBy: 'admin@club' });
    const body = await (await get()).json();
    expect(body.workouts[0].load).toBeGreaterThan(0);
    expect(db.log.some(l => l.op === 'upsert')).toBe(false);
  });

  it('without migration 142 the week still has its ⚡, and writes nothing', async () => {
    const { activity_loads: _gone, ...rest } = SCHEMA;
    const rows = db.tables;
    db = createMemoryDb({ schema: rest });
    for (const t of Object.keys(rest)) db.tables[t].push(...rows[t]);
    const body = await (await get()).json();
    expect(body.workouts[0].load).toBeGreaterThan(0);
    expect(db.log.some(l => l.op !== 'select')).toBe(false);
  });
});
