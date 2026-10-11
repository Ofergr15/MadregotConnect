import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/**
 * lib/academy/readiness-server.ts against an in-memory PostgREST: the reads behind C1/C2
 * and the pace gate. What only the reads can get wrong — pricing the missing loads (and
 * NOT storing them under view-as), still having a form before migration 142, scoping every
 * read to the trainees asked about, and reading pain, feel, the race and the morning RHR.
 */

const week = vi.fn();
vi.mock('@/lib/academy/report', async (orig) => ({
  ...(await orig() as object),
  computeAcademyWeekAdherence: (opts: unknown) => week(opts),
}));

const { loadReadinessInputs, loadWeekCounts } = await import('@/lib/academy/readiness-server');

const israelDay = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};
const TODAY = israelDay();

const SCHEMA: Record<string, string[]> = {
  athlete_activities: ['id', 'athlete_id', 'start_time', 'activity_type', 'distance', 'duration', 'moving_duration', 'average_hr', 'max_hr', 'laps', 'splits'],
  academy_tests: ['id', 'athlete_id', 'test_date', 'protocol', 'duration_sec', 'distance_m', 'excluded_reason', 'status'],
  athlete_wellness: ['athlete_id', 'date', 'resting_hr', 'sleep_seconds'],
  workout_feedback: ['athlete_id', 'feel', 'difficulty', 'pain', 'created_at'],
  athletes: ['id', 'name', 'gender', 'is_academy', 'status'],
  academy_candidates: ['id', 'athlete_id'],
  academy_characterizations: ['candidate_id', 'target_race', 'target_race_date'],
};
const LOADS = ['activity_id', 'athlete_id', 'activity_date', 'load', 'source', 'threshold_sec', 'basis_test_date', 'formula_version', 'computed_at'];

const CALM = uid();
const TIRED = uid();
const OTHER = uid();
let db: ReturnType<typeof createMemoryDb>;

const km = (n: number, pace: number) => Array.from({ length: n }, () => ({ distance: 1000, duration: pace }));
function run(athleteId: string, daysAgo: number, kms: number, pace: number, extra: Record<string, unknown> = {}) {
  db.tables.athlete_activities.push({
    id: uid(), athlete_id: athleteId, start_time: `${israelDay(-daysAgo)}T06:00:00`, activity_type: 'running',
    distance: kms * 1000, duration: kms * pace, moving_duration: kms * pace, average_hr: 150, max_hr: 178, laps: null,
    splits: km(kms, pace), ...extra,
  });
}

function seed(withTable: boolean) {
  db = createMemoryDb({ schema: withTable ? { ...SCHEMA, activity_loads: LOADS } : SCHEMA });
  db.tables.athletes.push(
    { id: CALM, name: 'Shahar Glazner', gender: 'male', is_academy: true, status: 'active' },
    { id: TIRED, name: 'Yoav Cohen', gender: 'male', is_academy: true, status: 'active' },
    { id: OTHER, name: 'Not Asked', gender: 'female', is_academy: true, status: 'active' },
  );
  for (const id of [CALM, TIRED, OTHER]) {
    db.tables.academy_tests.push({ id: uid(), athlete_id: id, test_date: israelDay(-200), protocol: '30min', duration_sec: 1800, distance_m: 7143, excluded_reason: null, status: 'approved' });
  }
  // 70 days of an every-other-day 10 km for both; the tired one then crushes the last week.
  for (let i = 70; i >= 2; i -= 2) { run(CALM, i, 10, 330); run(TIRED, i, 10, 330); run(OTHER, i, 10, 330); }
  for (let i = 7; i >= 1; i -= 1) { run(TIRED, i, 24, 290); run(TIRED, i, 10, 300); }
  // 30 mornings: calm inside 46–50; tired the same, then 3 above.
  for (let i = 30; i >= 0; i -= 1) {
    db.tables.athlete_wellness.push({ athlete_id: CALM, date: israelDay(-i), resting_hr: 46 + (i % 5), sleep_seconds: 26000 });
    db.tables.athlete_wellness.push({ athlete_id: TIRED, date: israelDay(-i), resting_hr: i <= 2 ? 58 : 46 + (i % 5), sleep_seconds: 26000 });
  }
  db.tables.workout_feedback.push(
    { athlete_id: CALM, feel: 3, difficulty: 6, pain: false, created_at: `${israelDay(-1)}T08:00:00Z` },
    { athlete_id: CALM, feel: 3, difficulty: 7, pain: false, created_at: `${israelDay(-3)}T08:00:00Z` },
    { athlete_id: OTHER, feel: 0, difficulty: 9, pain: true, created_at: `${israelDay(-1)}T08:00:00Z` },
  );
  const cand = uid();
  db.tables.academy_candidates.push({ id: cand, athlete_id: CALM });
  db.tables.academy_characterizations.push({ candidate_id: cand, target_race: '10 ק״מ', target_race_date: israelDay(4) });
}

beforeEach(() => {
  seed(true);
  week.mockReset();
});

describe('loadReadinessInputs', () => {
  it('prices the missing loads, stores them, and returns each trainee\'s readiness', async () => {
    const out = await loadReadinessInputs(db.client as any, [CALM, TIRED], TODAY, { write: true });
    expect(Object.keys(out).sort()).toEqual([CALM, TIRED].sort());
    expect(db.tables.activity_loads.length).toBeGreaterThan(60);

    const calm = out[CALM];
    expect(calm).toMatchObject({ name: 'Shahar Glazner', gender: 'male', isAcademy: true, active: true });
    expect(calm.inputs.status).toEqual({ kind: 'ok' });
    expect(calm.inputs.pmcToday).not.toBeNull();
    expect(calm.inputs.spark.length).toBeGreaterThan(1);
    expect(calm.inputs.gate).toEqual({ paused: false, reasons: [] });
    expect(calm.inputs.feelFace).toBe(3);
    expect(calm.inputs.effortAvg4).toBe(6.5);
    expect([calm.inputs.raceDays, calm.inputs.raceName]).toEqual([4, '10 ק״מ']);
    expect(calm.inputs.daysSinceRun).toBe(2);
    expect(calm.inputs.rhr.range).toEqual({ lo: expect.any(Number), hi: expect.any(Number) });

    const tired = out[TIRED];
    expect(tired.inputs.pmcToday!.form).toBeLessThanOrEqual(-30);
    expect(tired.inputs.rhr.streak.flag).toBe(true);
    expect(tired.inputs.gate).toEqual({ paused: true, reasons: ['veryTired', 'rhr'] });
  });

  it('reads only the trainees asked about', async () => {
    await loadReadinessInputs(db.client as any, [CALM], TODAY, { write: true });
    const leaked = db.tables.activity_loads.filter(r => r.athlete_id !== CALM);
    expect(leaked).toEqual([]);
    for (const l of db.log.filter(x => ['athlete_wellness', 'workout_feedback', 'athletes'].includes(x.table))) {
      expect(l.filters.join(' ')).toContain(CALM);
      expect(l.filters.join(' ')).not.toContain(OTHER);
    }
  });

  it('under view-as prices in memory and stores nothing — with the same numbers', async () => {
    const stored = await loadReadinessInputs(db.client as any, [CALM], TODAY, { write: true });
    seed(true);
    const viewAs = await loadReadinessInputs(db.client as any, [CALM], TODAY, { write: false });
    expect(db.log.some(l => l.op === 'upsert')).toBe(false);
    expect(db.tables.activity_loads).toHaveLength(0);
    expect(viewAs[CALM].inputs.pmcToday).toEqual(stored[CALM].inputs.pmcToday);
  });

  it('before migration 142: the in-memory loads still give a form, and the gate still pauses', async () => {
    seed(false);
    const out = await loadReadinessInputs(db.client as any, [CALM, TIRED], TODAY, { write: true });
    expect(db.log.some(l => l.op !== 'select')).toBe(false);
    expect(out[CALM].inputs.status.kind).toBe('ok');
    expect(out[TIRED].inputs.gate.reasons).toEqual(['veryTired', 'rhr']);
  });

  it('pain this week and a weak feel pause; a read that fails pauses nobody', async () => {
    const out = await loadReadinessInputs(db.client as any, [OTHER], TODAY, { write: false });
    expect(out[OTHER].inputs.gate.reasons).toEqual(['pain', 'feel']);
    // No wellness table at all: no flag, no error.
    const bare = createMemoryDb({ schema: Object.fromEntries(Object.entries(SCHEMA).filter(([t]) => t !== 'athlete_wellness' && t !== 'workout_feedback')) });
    bare.tables.athletes.push({ id: CALM, name: 'S', gender: null, is_academy: true, status: 'active' });
    const empty = await loadReadinessInputs(bare.client as any, [CALM], TODAY, { write: false });
    expect(empty[CALM].inputs.gate).toEqual({ paused: false, reasons: [] });
    expect(empty[CALM].inputs.rhr.range).toBeNull();
  });

  it('a 1 km record today', async () => {
    const lap = (m: number, s: number) => ({ distance: m, duration: s });
    const repsRun = (daysAgo: number, rep: number) => run(CALM, daysAgo, 7, 300, {
      laps: [lap(1000, 340), lap(1000, 340), lap(1000, rep), lap(333, 120), lap(1000, rep + 2), lap(1000, 340), lap(1000, 340)],
    });
    repsRun(5, 245);
    repsRun(0, 236);
    const out = await loadReadinessInputs(db.client as any, [CALM], TODAY, { write: false });
    expect(out[CALM].inputs.prToday).toEqual({ bucket: '1k', daysAgo: 0 });
  });

  it('prices the NEWEST first: a long history still being priced is short of its oldest runs', async () => {
    for (let i = 300; i > 70; i -= 2) run(CALM, i, 8, 340);
    await loadReadinessInputs(db.client as any, [CALM], TODAY, { write: true });
    const dates = db.tables.activity_loads.filter(r => r.athlete_id === CALM).map(r => String(r.activity_date)).sort();
    expect(dates).toHaveLength(100);
    expect(dates[dates.length - 1]).toBe(israelDay(-2));
    expect(dates[0] > israelDay(-300)).toBe(true);
  });

  it('nothing asked, nothing read', async () => {
    expect(await loadReadinessInputs(db.client as any, [], TODAY)).toEqual({});
    expect(db.log).toHaveLength(0);
  });
});

describe('loadWeekCounts', () => {
  it('this week\'s done of planned, from the adherence the coach tools grade with', async () => {
    week.mockResolvedValue({ athletes: [{ athleteId: CALM, name: 'S', week: { completedCount: 3, plannedCount: 5 } }] });
    expect(await loadWeekCounts([CALM], TODAY)).toEqual({ [CALM]: { done: 3, planned: 5 } });
    expect(week.mock.calls[0][0]).toMatchObject({ onlyAthleteIds: [CALM] });
  });

  it('an adherence failure is no counts, not an error', async () => {
    week.mockRejectedValue(new Error('boom'));
    expect(await loadWeekCounts([CALM], TODAY)).toEqual({});
  });
});
