import { describe, expect, it } from 'vitest';
import { laneReferences } from '@/lib/academy/senior-pick';
import { COACH_ID } from '@/lib/constants';
import { LOAD_VERSION, shiftDate } from '@/lib/academy/load';
import {
  athleteLoads, ensureActivityLoads, hasActivityLoadsTable, isStale, loadDailyRows, plannedLoads, rhrOn, sweepActivityLoads,
} from '@/lib/academy/load-server';
import { createMemoryDb, uid } from './helpers/memory-db';

/**
 * The load engine against a database (helpers/memory-db): pricing what is missing or
 * stale and storing it (migration 142), the in-memory path before 142 is pasted, view-as
 * writing nothing, the nightly sweep, and the planned load of the trainee's OWN week.
 */

const TODAY = '2026-10-13';

const SCHEMA = {
  athlete_activities: ['id', 'athlete_id', 'start_time', 'activity_type', 'distance', 'duration', 'moving_duration', 'average_hr', 'max_hr', 'laps', 'splits'],
  academy_tests: ['id', 'athlete_id', 'test_date', 'protocol', 'duration_sec', 'distance_m', 'excluded_reason', 'status'],
  athlete_wellness: ['athlete_id', 'date', 'resting_hr', 'sleep_seconds'],
  athletes: ['id', 'group_id', 'name'],
  groups: ['id', 'name'],
  weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'parsed_workouts', 'status', 'created_at'],
};
const LOADS = ['activity_id', 'athlete_id', 'activity_date', 'load', 'source', 'threshold_sec', 'basis_test_date', 'formula_version', 'computed_at'];

function setup(opts: { withTable?: boolean } = {}) {
  const schema: Record<string, string[]> = { ...SCHEMA };
  if (opts.withTable !== false) schema.activity_loads = LOADS;
  const db = createMemoryDb({ schema });
  const athlete = uid();
  db.tables.athletes.push({ id: athlete, group_id: null, name: 'Shahar' });
  return { ...db, athlete };
}

/** An easy run of `km` at `pace` sec/km, as per-km splits. */
function addRun(db: ReturnType<typeof setup>, date: string, km = 8, pace = 330, extra: Record<string, unknown> = {}) {
  const id = uid();
  db.tables.athlete_activities.push({
    id, athlete_id: db.athlete, start_time: `${date}T07:00:00`, activity_type: 'running',
    distance: km * 1000, duration: km * pace, moving_duration: km * pace, average_hr: 148, max_hr: 175,
    laps: null, splits: Array.from({ length: km }, () => ({ distance: 1000, duration: pace, averageHR: 148 })),
    ...extra,
  });
  return id;
}

const test30 = (athleteId: string, date: string, distanceM: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: uid(), athlete_id: athleteId, test_date: date, protocol: '30min', duration_sec: 1800, distance_m: distanceM,
  excluded_reason: null, status: 'approved', ...extra,
});

describe('ensureActivityLoads', () => {
  it('prices every missing run once and stores it', async () => {
    const db = setup();
    db.tables.academy_tests.push(test30(db.athlete, '2026-09-01', 7143)); // 252 s/km
    const a = addRun(db, '2026-10-01');
    addRun(db, '2026-10-05');
    const first = await ensureActivityLoads(db.client, db.athlete, { today: TODAY });
    expect(first).toMatchObject({ wrote: 2, pending: 0, stored: true });
    const row = db.tables.activity_loads.find(r => r.activity_id === a)!;
    expect(row).toMatchObject({ athlete_id: db.athlete, activity_date: '2026-10-01', source: 'pace', threshold_sec: 252, basis_test_date: '2026-09-01', formula_version: LOAD_VERSION });
    expect(row.load).toBe(Math.round(100 * (8 * 330 / 3600) * (252 / 330) ** 2));

    const again = await ensureActivityLoads(db.client, db.athlete, { today: TODAY });
    expect(again).toMatchObject({ wrote: 0, rows: [] });
  });

  it('reads laps only for the activities it prices', async () => {
    const db = setup();
    addRun(db, '2026-10-01');
    await ensureActivityLoads(db.client, db.athlete, { today: TODAY });
    db.log.length = 0;
    addRun(db, '2026-10-06');
    await ensureActivityLoads(db.client, db.athlete, { today: TODAY });
    const heavy = db.log.filter(l => l.table === 'athlete_activities' && l.columns?.includes('laps'));
    expect(heavy).toHaveLength(1);
    expect(heavy[0].filters.join()).toContain('id=in.(');
  });

  it('re-prices only the runs a new test covers', async () => {
    const db = setup();
    db.tables.academy_tests.push(test30(db.athlete, '2026-07-01', 6897)); // 261
    const before = addRun(db, '2026-09-10');
    const after = addRun(db, '2026-10-01');
    await ensureActivityLoads(db.client, db.athlete, { today: TODAY });
    db.tables.academy_tests.push(test30(db.athlete, '2026-09-16', 7143)); // 252
    const r = await ensureActivityLoads(db.client, db.athlete, { today: TODAY });
    expect(r.rows.map(x => x.activityId)).toEqual([after]);
    expect(db.tables.activity_loads.find(x => x.activity_id === after)).toMatchObject({ threshold_sec: 252, basis_test_date: '2026-09-16' });
    expect(db.tables.activity_loads.find(x => x.activity_id === before)).toMatchObject({ threshold_sec: 261 });
  });

  it('an HR-priced run becomes a pace run once a test covers it; an excluded test re-prices back', async () => {
    const db = setup();
    for (let d = 1; d <= 5; d += 1) db.tables.athlete_wellness.push({ athlete_id: db.athlete, date: `2026-09-2${d}`, resting_hr: 50 });
    addRun(db, '2026-08-01'); addRun(db, '2026-08-15');
    const a = addRun(db, '2026-09-28');
    await ensureActivityLoads(db.client, db.athlete, { today: TODAY });
    expect(db.tables.activity_loads.find(x => x.activity_id === a)!.source).toBe('hr');

    const t = test30(db.athlete, '2026-09-20', 7143);
    db.tables.academy_tests.push(t);
    await ensureActivityLoads(db.client, db.athlete, { today: TODAY });
    expect(db.tables.activity_loads.find(x => x.activity_id === a)!.source).toBe('pace');

    t.excluded_reason = 'רוח';
    await ensureActivityLoads(db.client, db.athlete, { today: TODAY });
    expect(db.tables.activity_loads.find(x => x.activity_id === a)).toMatchObject({ source: 'hr', basis_test_date: null });
  });

  it('a new trainee\'s first runs are HR-priced too: max HR is as of today, not as of each run', async () => {
    const db = setup();
    for (let d = 1; d <= 5; d += 1) db.tables.athlete_wellness.push({ athlete_id: db.athlete, date: `2026-10-0${d}`, resting_hr: 57 });
    const first = addRun(db, '2026-09-24', 5, 370);
    addRun(db, '2026-09-30', 5, 370); addRun(db, '2026-10-06', 5, 370);
    await ensureActivityLoads(db.client, db.athlete, { today: TODAY });
    expect(db.tables.activity_loads.find(x => x.activity_id === first)).toMatchObject({ source: 'hr' });
    expect(db.tables.activity_loads.every(x => x.load > 0)).toBe(true);
  });

  it('runs stored with no load before a max HR existed are priced again once a 3rd run brings one', async () => {
    const db = setup();
    for (let d = 1; d <= 5; d += 1) db.tables.athlete_wellness.push({ athlete_id: db.athlete, date: `2026-10-0${d}`, resting_hr: 57 });
    addRun(db, '2026-09-24', 5, 370); addRun(db, '2026-09-30', 5, 370);
    await ensureActivityLoads(db.client, db.athlete, { today: '2026-10-01' });
    expect(db.tables.activity_loads.map(x => x.source)).toEqual(['none', 'none']);
    addRun(db, '2026-10-06', 5, 370);
    const r = await ensureActivityLoads(db.client, db.athlete, { today: TODAY });
    expect(r.rows).toHaveLength(3);
    expect(db.tables.activity_loads.every(x => x.source === 'hr' && x.load > 0)).toBe(true);
    // Priced: nothing is stale any more, so the next read prices nothing.
    expect((await ensureActivityLoads(db.client, db.athlete, { today: TODAY })).rows).toHaveLength(0);
  });

  it('a none row is stale only when the HR basis now exists for it', () => {
    const none = { formula_version: LOAD_VERSION, basis_test_date: null, source: 'none' };
    expect(isStale(none, null)).toBe(false);
    expect(isStale(none, null, true)).toBe(true);
    expect(isStale({ ...none, source: 'hr' }, null, true)).toBe(false);
  });

  it('a row from an older formula is stale', () => {
    expect(isStale({ formula_version: LOAD_VERSION - 1, basis_test_date: null, source: 'hr' }, null)).toBe(true);
    expect(isStale({ formula_version: LOAD_VERSION, basis_test_date: '2026-09-16', source: 'pace' }, '2026-09-16')).toBe(false);
    expect(isStale({ formula_version: LOAD_VERSION, basis_test_date: null, source: 'hr' }, '2026-09-16')).toBe(true);
    expect(isStale({ formula_version: LOAD_VERSION, basis_test_date: null, source: 'not_run' }, null)).toBe(false);
  });

  it('prices at most maxNew a call, oldest first, and says how many wait', async () => {
    const db = setup();
    const ids = [1, 2, 3, 4, 5].map(d => addRun(db, `2026-10-0${d}`));
    const r = await ensureActivityLoads(db.client, db.athlete, { today: TODAY, maxNew: 2 });
    expect(r.rows.map(x => x.activityId)).toEqual(ids.slice(0, 2));
    expect(r.pending).toBe(3);
  });

  it('stores bikes as not_run and unpriceable runs as none, so they are not re-read', async () => {
    const db = setup();
    addRun(db, '2026-10-01', 30, 120, { activity_type: 'cycling' });
    addRun(db, '2026-10-02', 5, 330, { average_hr: null, splits: null });
    await ensureActivityLoads(db.client, db.athlete, { today: TODAY });
    expect(db.tables.activity_loads.map(r => [r.source, r.load])).toEqual([['not_run', null], ['none', null]]);
    expect((await ensureActivityLoads(db.client, db.athlete, { today: TODAY })).rows).toEqual([]);
  });

  it('dates a 23:30 run on its own Israel day', async () => {
    const db = setup();
    addRun(db, '2026-10-12', 5, 330, { start_time: '2026-10-12T23:30:00' });
    await ensureActivityLoads(db.client, db.athlete, { today: TODAY });
    expect(db.tables.activity_loads[0].activity_date).toBe('2026-10-12');
  });

  it('with write: false (view-as) prices the same rows and stores nothing', async () => {
    const db = setup();
    addRun(db, '2026-10-01');
    const r = await ensureActivityLoads(db.client, db.athlete, { today: TODAY, write: false });
    expect(r.rows).toHaveLength(1);
    expect(r.wrote).toBe(0);
    expect(db.tables.activity_loads).toHaveLength(0);
    expect(db.log.some(l => l.op === 'upsert')).toBe(false);
  });
});

describe('before migration 142', () => {
  it('detects the missing table and computes in memory over the stored path\'s 400 days, writing nothing (issue 7)', async () => {
    const db = setup({ withTable: false });
    db.tables.academy_tests.push(test30(db.athlete, '2026-01-01', 7143));
    addRun(db, shiftDate(TODAY, -150));
    addRun(db, shiftDate(TODAY, -40));
    addRun(db, shiftDate(TODAY, -2));
    expect(await hasActivityLoadsTable(db.client)).toBe(false);
    const { rows, stored } = await loadDailyRows(db.client, [db.athlete], shiftDate(TODAY, -400), { today: TODAY });
    expect(stored).toBe(false);
    // The same window the stored path keeps: a 150-day-old run is in it, as it would be stored.
    expect(rows.map(r => r.date)).toEqual([shiftDate(TODAY, -150), shiftDate(TODAY, -40), shiftDate(TODAY, -2)]);
    expect(rows.every(r => r.source === 'pace' && r.load! > 0)).toBe(true);
    expect(db.log.some(l => l.op === 'upsert' || l.op === 'insert')).toBe(false);
    const heavy = db.log.find(l => l.table === 'athlete_activities' && l.columns?.includes('laps'));
    expect(heavy?.columns).not.toContain('stream');
  });

  it('athleteLoads gives the same numbers either way', async () => {
    const withTable = setup();
    const without = setup({ withTable: false });
    for (const db of [withTable, without]) {
      db.tables.academy_tests.push(test30(db.athlete, '2026-01-01', 7143));
      addRun(db, '2026-10-01'); addRun(db, '2026-10-04', 12, 300);
    }
    const a = await athleteLoads(withTable.client, withTable.athlete, { since: '2026-01-01', write: true, today: TODAY });
    const b = await athleteLoads(without.client, without.athlete, { since: '2026-01-01', write: true, today: TODAY });
    expect(a.stored).toBe(true);
    expect(b.stored).toBe(false);
    expect(a.rows.map(r => r.load)).toEqual(b.rows.map(r => r.load));
  });
});

describe('athleteLoads under view-as', () => {
  it('shows the priced rows without storing them', async () => {
    const db = setup();
    addRun(db, '2026-10-01');
    db.tables.academy_tests.push(test30(db.athlete, '2026-01-01', 7143));
    const r = await athleteLoads(db.client, db.athlete, { since: '2026-01-01', write: false, today: TODAY });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].load).toBeGreaterThan(0);
    expect(db.tables.activity_loads).toHaveLength(0);
  });
});

describe('sweepActivityLoads', () => {
  it('skips without the table', async () => {
    const db = setup({ withTable: false });
    expect(await sweepActivityLoads(db.client, { athletes: [db.athlete], budgetMs: 1000 })).toMatchObject({ skipped: 'no_table', athletes: 0 });
  });

  it('prices every athlete within the budget, and stops when it runs out', async () => {
    const db = setup();
    addRun(db, shiftDate(israelDay(), -3));
    const other = uid();
    const r = await sweepActivityLoads(db.client, { athletes: [db.athlete, other], budgetMs: 10_000 });
    expect(r).toMatchObject({ athletes: 2, priced: 1, timedOut: false });

    let t = 0;
    const out = await sweepActivityLoads(db.client, { athletes: [db.athlete, other], budgetMs: 5, now: () => (t += 10) });
    expect(out).toMatchObject({ athletes: 0, timedOut: true });
  });
});

describe('plannedLoads', () => {
  const week = (pace: number) => ({
    workouts: [{ dayOfWeek: 2, name: 'חזרות', steps: [{ order: 1, type: 'interval', durationType: 'distance', durationValue: 5000, targetType: 'pace', targetPaceMinPerKm: pace }] }],
  });

  it('prices the trainee\'s own week, never another trainee\'s, over the group plan', async () => {
    const db = setup();
    const stranger = uid();
    db.tables.weekly_plans.push(
      { id: uid(), coach_id: COACH_ID, athlete_id: null, week_start_date: '2026-10-11', parsed_workouts: { group2: week(300) }, status: 'pushed', created_at: '2026-10-01' },
      { id: uid(), coach_id: COACH_ID, athlete_id: stranger, week_start_date: '2026-10-11', parsed_workouts: week(200), status: 'pushed', created_at: '2026-10-02' },
      { id: uid(), coach_id: COACH_ID, athlete_id: db.athlete, week_start_date: '2026-10-11', parsed_workouts: week(252), status: 'draft', created_at: '2026-10-03' },
    );
    const r = await plannedLoads(db.client, db.athlete, ['2026-10-11'], 252);
    expect(Math.round(r.byWeek['2026-10-11'])).toBe(Math.round(100 * (5 * 252 / 3600)));
    expect(Object.keys(r.byDate)).toEqual(['2026-10-13']);
  });

  it('falls back to the group plan restated to the trainee\'s paces, and is empty without a threshold', async () => {
    const db = setup();
    db.tables.weekly_plans.push({ id: uid(), coach_id: COACH_ID, athlete_id: null, week_start_date: '2026-10-11', parsed_workouts: { group2: week(300) }, status: 'pushed', created_at: '2026-10-01' });
    // The club's 5:00 is written for lane 1's reference; at the trainee's 4:12 it is
    // 5:00 × 252 / ref — the session as the board draws it for them.
    const ref = laneReferences()[1];
    const mine = Math.round(300 * (252 / ref));
    const expected = 100 * ((5 * mine) / 3600) * (252 / mine) ** 2;
    expect(Math.round((await plannedLoads(db.client, db.athlete, ['2026-10-11'], 252)).byWeek['2026-10-11'])).toBe(Math.round(expected));
    expect(await plannedLoads(db.client, db.athlete, ['2026-10-11'], null)).toEqual({ byWeek: {}, byDate: {} });
  });
});

describe('rhrOn', () => {
  it('is the median of the 30 mornings up to the run, else of the newest stored ones', () => {
    const nights = [48, 50, 52, 46].map((v, i) => ({ date: `2026-10-0${i + 1}`, resting_hr: v }));
    expect(rhrOn(nights, '2026-10-05')).toBe(49);
    expect(rhrOn(nights, '2026-05-01')).toBe(49);
    expect(rhrOn([], '2026-05-01')).toBeNull();
  });
});

function israelDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

describe('a long history on its first open (issue 4)', () => {
  it('athleteLoads prices round after round until nothing is pending, so the first number is the settled one', async () => {
    const db = setup();
    db.tables.academy_tests.push(test30(db.athlete, '2025-01-01', 7143));
    for (let d = 1; d <= 380; d += 1) addRun(db, shiftDate(TODAY, -d));
    const r = await athleteLoads(db.client, db.athlete, { since: shiftDate(TODAY, -400), write: true, today: TODAY });
    expect(r.pending).toBe(0);
    expect(r.rows).toHaveLength(380);
    expect(db.tables.activity_loads).toHaveLength(380);
  });

  it('under view-as one round is priced and the rest stays pending (the screen says it is computing)', async () => {
    const db = setup();
    db.tables.academy_tests.push(test30(db.athlete, '2025-01-01', 7143));
    for (let d = 1; d <= 380; d += 1) addRun(db, shiftDate(TODAY, -d));
    const r = await athleteLoads(db.client, db.athlete, { since: shiftDate(TODAY, -400), write: false, today: TODAY });
    expect(r.pending).toBe(80);
  });

  it('the nightly sweep settles a heavy history in one run instead of stopping at one call', async () => {
    const db = setup();
    db.tables.academy_tests.push(test30(db.athlete, '2025-01-01', 7143));
    for (let d = 1; d <= 380; d += 1) addRun(db, shiftDate(TODAY, -d));
    const r = await sweepActivityLoads(db.client, { athletes: [db.athlete], budgetMs: 60_000 });
    expect(r).toMatchObject({ athletes: 1, priced: 380, pending: 0, timedOut: false });
  });
});
