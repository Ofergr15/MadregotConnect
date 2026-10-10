import { describe, expect, it } from 'vitest';
import { shiftDate } from '@/lib/academy/load';
import type { LoadRow } from '@/lib/academy/pmc';
import { fitnessChart } from '@/lib/academy/progress';
import {
  SPARK, buildReadinessInputs, initialsOf, pmcOf, projectionOf, readinessAlert, readinessRows, recentRecord,
  sparkGeometry, sparkOf, weeklySeries, type ReadinessInputs, type RecordRun,
} from '@/lib/academy/readiness-board';

/**
 * The coach's readiness board (C1/C2), pure. Against the mockup's ONE load diary (the
 * one academyPmc.test.ts checks: fitness 47, fatigue 56, form −9 on Tue 13.10) and the
 * people of the lab seed: Yoav very tired with 3 high mornings, Shahar a 1 km record today,
 * Michal a race on Saturday, Alon 9 days without a run.
 */

const TODAY = '2026-10-13'; // Tuesday
const SHAPE = [58, 31, 62, 0, 70, 0, 92];
function week(total: number): number[] {
  const s = SHAPE.reduce((a, b) => a + b, 0);
  const w = SHAPE.map(v => Math.round((total * v) / s));
  w[6] += total - w.reduce((a, b) => a + b, 0);
  return w;
}
function mockupDiary(): LoadRow[] {
  const days: number[] = [];
  for (let i = 0; i < 12; i += 1) days.push(...week(300));
  for (const t of [322, 332, 349, 232, 362, 405]) days.push(...week(t));
  days.push(120, 40, 70, 0, 70, 0, 135);
  days.push(58, 31);
  const start = shiftDate('2026-08-23', -12 * 7);
  return days.flatMap((load, i) => (load > 0 ? [{ date: shiftDate(start, i), load, source: 'pace' as const }] : []));
}

/** 30 mornings, oldest first, ending today. */
const mornings = (values: number[], end = TODAY) =>
  values.map((v, i) => ({ date: shiftDate(end, i - values.length + 1), resting_hr: v, sleep_seconds: 26000 }));
const calmRhr = Array.from({ length: 30 }, (_, i) => 46 + (i % 5));

describe('pmcOf: the trainee\'s own numbers', () => {
  it('reads the mockup diary as 47 / 56 / −9, ramp 1, "שומר"', () => {
    const p = pmcOf(mockupDiary(), TODAY);
    expect(p.status).toEqual({ kind: 'ok' });
    expect(p.today).toEqual({ fitness: 47, fatigue: 56, form: -9, ramp: 1 });
    expect(p.bandKey).toBe('maintain');
    expect(p.rampWordKey).toBe('maintaining');
    // The 435 week after ~370 average: "אחרי שבוע עמוס".
    expect(p.heavyLastWeek).toBe(true);
    expect(p.series[p.series.length - 1].date).toBe(shiftDate(TODAY, -1));
  });

  it('says nothing while learning: no numbers, no band', () => {
    const rows: LoadRow[] = [{ date: shiftDate(TODAY, -10), load: 50, source: 'hr' }];
    const p = pmcOf(rows, TODAY);
    expect(p.status.kind).toBe('learning');
    expect(p.today).toBeNull();
    expect(p.bandKey).toBeNull();
  });
});

describe('the spark (C1)', () => {
  it('is fitness at the last 7 Saturdays and yesterday, oldest first — rising toward today', () => {
    const p = pmcOf(mockupDiary(), TODAY);
    const spark = sparkOf(p, TODAY);
    expect(spark).toHaveLength(8);
    expect(spark[spark.length - 1]).toBeCloseTo(47, 0);
    expect(spark[spark.length - 1]).toBeGreaterThan(spark[0]);
  });

  it('is empty unless the numbers are ok (a learning trainee would draw a climb from 0)', () => {
    expect(sparkOf({ status: { kind: 'learning', daysLeft: 20, daysSeen: 22 }, series: pmcOf(mockupDiary(), TODAY).series }, TODAY)).toEqual([]);
  });

  it('draws oldest LEFT and ends on a dot at the right', () => {
    const g = sparkGeometry([30, 32, 35, 37, 40, 42, 52])!;
    expect(g.path.startsWith(`M${SPARK.padL.toFixed(1)}`)).toBe(true);
    expect(g.end.x).toBe(SPARK.width - SPARK.padR);
    expect(g.end.y).toBeLessThan(10); // the highest value is near the top
    expect(sparkGeometry([40])).toBeNull();
  });
});

describe('C2: 8 weeks and the projection', () => {
  const rows = mockupDiary();
  const p = pmcOf(rows, TODAY);

  it('8 weeks back from yesterday, one point a week', () => {
    const s = weeklySeries(p.series, TODAY);
    expect(s).toHaveLength(9);
    expect(s[0].date).toBe(shiftDate(TODAY, -57));
    expect(s[8].date).toBe(shiftDate(TODAY, -1));
  });

  it('the rest of this week and next week as planned → form about −3: room to add', () => {
    const plannedByDate: Record<string, number> = { [TODAY]: 62, '2026-10-15': 70, '2026-10-17': 92 };
    week(330).forEach((v, i) => { if (v) plannedByDate[shiftDate('2026-10-18', i)] = v; });
    const pr = projectionOf({ pmc: p, today: TODAY, ranToday: null, plannedByDate })!;
    expect(pr.nextWeekLoad).toBe(330);
    expect(Math.abs(pr.projectedForm - -3)).toBeLessThanOrEqual(1);
    expect(pr.verdict).toBe('room');
    // This Saturday, then next Saturday: the far right.
    expect(pr.series.map(x => x.date)).toEqual(['2026-10-17', '2026-10-24']);
  });

  it('today\'s run counts as run, not as planned', () => {
    const base = { pmc: p, today: TODAY, plannedByDate: { [TODAY]: 62 } };
    const asPlanned = projectionOf({ ...base, ranToday: null })!;
    const ranHard = projectionOf({ ...base, ranToday: 160 })!;
    expect(ranHard.projectedForm).toBeLessThan(asPlanned.projectedForm);
  });

  it('warns at −30 or below, and has no next-week load without a plan', () => {
    const heavy: Record<string, number> = {};
    for (let i = 0; i < 12; i += 1) heavy[shiftDate(TODAY, i)] = 170;
    expect(projectionOf({ pmc: p, today: TODAY, ranToday: null, plannedByDate: heavy })!.verdict).toBe('warn');
    expect(projectionOf({ pmc: p, today: TODAY, ranToday: null, plannedByDate: {} })!.nextWeekLoad).toBeNull();
  });

  it('is null while the numbers are being learned', () => {
    expect(projectionOf({ pmc: { status: { kind: 'insufficient' }, series: p.series }, today: TODAY, ranToday: null, plannedByDate: {} })).toBeNull();
  });

  it('the chart puts the projection to the RIGHT of today, in its own zone (G1)', () => {
    const plannedByDate: Record<string, number> = { '2026-10-15': 70, '2026-10-17': 92 };
    const pr = projectionOf({ pmc: p, today: TODAY, ranToday: 64, plannedByDate })!;
    const g = fitnessChart(weeklySeries(p.series, TODAY), { width: 326, height: 104, projection: pr.series, axis: 'weeks' })!;
    expect(g.projection).not.toBeNull();
    expect(g.projection!.zoneX).toBe(g.end.x);
    expect(g.projection!.end.x).toBeGreaterThan(g.end.x);
    expect(g.projection!.end.x).toBeLessThanOrEqual(326);
    const kinds = g.labels.map(l => l.kind);
    expect(kinds[0]).toBe('ago');
    expect(kinds.slice(-2)).toEqual(['today', 'next']);
    expect(g.labels[0].weeks).toBe(8);
    // Without a projection the chart is the trainee's own (screen 7) — no zone.
    expect(fitnessChart(weeklySeries(p.series, TODAY))!.projection).toBeNull();
  });
});

describe('recentRecord: "🏅 שיא ל־1 ק״מ היום"', () => {
  const lap = (m: number, s: number) => ({ distance: m, duration: s });
  const reps = (id: string, date: string, paces: number[]): RecordRun => ({
    id, start_time: `${date}T06:30:00+00:00`, activity_type: 'running',
    distance: 2000 + paces.length * 1333, duration: 680 + paces.reduce((a, b) => a + b, 0) + paces.length * 120,
    laps: [lap(1000, 340), lap(1000, 340), ...paces.flatMap(p => [lap(1000, p), lap(333, 120)])],
  });

  it('a faster kilometre today than any before it', () => {
    const today = reps('t', TODAY, [244, 243, 242, 241, 236]);
    const before = [reps('a', '2026-10-06', [244, 244, 244]), reps('b', '2026-09-29', [245, 244])];
    expect(recentRecord([today], [today, ...before], TODAY)).toEqual({ bucket: '1k', daysAgo: 0 });
  });

  it('yesterday\'s counts as yesterday; nothing when it is not faster, or there is nothing before', () => {
    const y = reps('y', shiftDate(TODAY, -1), [236]);
    const before = [reps('a', '2026-10-06', [244])];
    expect(recentRecord([y], [y, ...before], TODAY)).toEqual({ bucket: '1k', daysAgo: 1 });
    expect(recentRecord([reps('s', TODAY, [250])], before, TODAY)).toBeNull();
    expect(recentRecord([reps('f', TODAY, [236])], [], TODAY)).toBeNull();
  });

  it('a run of three days ago is not a "today" record', () => {
    expect(recentRecord([reps('o', shiftDate(TODAY, -3), [200])], [reps('a', '2026-09-01', [250])], TODAY)).toBeNull();
  });
});

describe('buildReadinessInputs + the gate', () => {
  const rows = mockupDiary();

  it('an ok trainee: numbers, a spark, no pause', () => {
    const { inputs } = buildReadinessInputs({ rows, nights: mornings(calmRhr), feedback: [{ feel: 3, difficulty: 6, created_at: `${TODAY}T05:00:00Z` }], today: TODAY });
    expect(inputs.pmcToday?.form).toBe(-9);
    expect(inputs.spark.length).toBe(8);
    expect(inputs.gate).toEqual({ paused: false, reasons: [] });
    expect(inputs.feelFace).toBe(3);
    expect(inputs.daysSinceRun).toBe(1);
  });

  it('three mornings above the range pause it ("rhr")', () => {
    const { inputs } = buildReadinessInputs({ rows, nights: mornings([...calmRhr.slice(0, 27), 58, 59, 60]), feedback: [], today: TODAY });
    expect(inputs.rhr.streak.flag).toBe(true);
    expect(inputs.gate.reasons).toEqual(['rhr']);
  });

  it('pain in the last 7 days pauses it; pain 8 days ago does not', () => {
    const pain = (daysAgo: number) => buildReadinessInputs({ rows, nights: [], feedback: [{ pain: true, created_at: `${shiftDate(TODAY, -daysAgo)}T10:00:00Z` }], today: TODAY }).inputs.gate.reasons;
    expect(pain(6)).toEqual(['pain']);
    expect(pain(7)).toEqual([]);
  });

  it('a weak feel over the last 4 pauses it', () => {
    const feedback = [1, 1, 0, 2].map((feel, i) => ({ feel, created_at: `${shiftDate(TODAY, -i * 2)}T10:00:00Z` }));
    expect(buildReadinessInputs({ rows, nights: [], feedback, today: TODAY }).inputs.gate.reasons).toEqual(['feel']);
  });

  it('a race ahead is days away; a race behind is nothing', () => {
    const ahead = buildReadinessInputs({ rows, nights: [], feedback: [], race: { name: '10 ק״מ', date: '2026-10-17' }, today: TODAY }).inputs;
    expect([ahead.raceDays, ahead.raceName]).toEqual([4, '10 ק״מ']);
    const behind = buildReadinessInputs({ rows, nights: [], feedback: [], race: { name: 'x', date: '2026-10-01' }, today: TODAY }).inputs;
    expect([behind.raceDays, behind.raceName]).toEqual([null, null]);
  });

  it('a trainee still learning is never paused on form, however low it is', () => {
    const young: LoadRow[] = Array.from({ length: 20 }, (_, i) => ({ date: shiftDate(TODAY, -20 + i), load: 250, source: 'pace' as const }));
    const { inputs } = buildReadinessInputs({ rows: young, nights: [], feedback: [], today: TODAY });
    expect(inputs.status.kind).toBe('learning');
    expect(inputs.gate.paused).toBe(false);
  });
});

describe('C1: rows and the one alert', () => {
  const people = [
    { athleteId: 'y', name: 'Yoav Cohen', gender: 'male' },
    { athleteId: 's', name: 'Shahar Glazner', gender: 'male' },
    { athleteId: 'p', name: 'Pain Only', gender: 'female' },
  ];
  const base = buildReadinessInputs({ rows: mockupDiary(), nights: [], feedback: [], today: TODAY }).inputs;
  const yoav: ReadinessInputs = {
    ...base, pmcToday: { fitness: 52, fatigue: 84, form: -32, ramp: 10 }, bandKey: 'veryTired',
    rhr: { ...base.rhr, streak: { flag: true, aboveRun: 3 } }, gate: { paused: true, reasons: ['veryTired', 'rhr'] },
  };
  const shahar: ReadinessInputs = { ...base, prToday: { bucket: '1k', daysAgo: 0 } };
  const painOnly: ReadinessInputs = { ...base, gate: { paused: true, reasons: ['pain'] } };
  const by = { y: yoav, s: shahar, p: painOnly };

  it('the alert is the very tired one with the high RHR; pain alone is not a red card', () => {
    expect(readinessAlert(people, by)).toEqual({ athleteId: 'y', name: 'Yoav Cohen', gender: 'male', reasons: ['veryTired', 'rhr'], aboveRun: 3 });
    expect(readinessAlert(people, { s: shahar, p: painOnly })).toBeNull();
  });

  it('the alert\'s row gets the next fact (the card already says the rest)', () => {
    const rows = readinessRows(people, by, { s: { done: 3, planned: 5 } }, 'y');
    expect(rows.find(r => r.athleteId === 'y')!.highlight).toEqual({ kind: 'rampTooFast', ramp: 10 });
    expect(rows.find(r => r.athleteId === 's')!.highlight).toEqual({ kind: 'pr', bucket: '1k', when: 'today' });
    expect(rows.find(r => r.athleteId === 's')).toMatchObject({ initials: 'SG', form: -9, bandKey: 'maintain', weekDone: 3, weekPlanned: 5, paused: false });
    // Without the alert on top, the row itself says it.
    expect(readinessRows(people, by, {}, null).find(r => r.athleteId === 'y')!.highlight).toEqual({ kind: 'veryTiredRhr' });
  });

  it('initials: first and last name', () => {
    expect(initialsOf('Yoav Cohen')).toBe('YC');
    expect(initialsOf('Sahar Ben Ami')).toBe('SA');
    expect(initialsOf('נועה')).toBe('נו');
  });
});
