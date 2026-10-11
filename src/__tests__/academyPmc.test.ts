import { describe, expect, it } from 'vitest';
import { shiftDate } from '@/lib/academy/load';
import {
  dailyLoads, isEasyWeek, lastWeeks, loadStatus, loadWeeks, plannedWeeksFor, pmcSeries, pmcToday, projectSeries, weekStartOf, weeklyLoads,
  FATIGUE_DAYS, FITNESS_DAYS, type LoadRow,
} from '@/lib/academy/pmc';

/**
 * Fitness / fatigue / form (spec §3.2) against the mockup's ONE load diary: weeks of 322,
 * 332, 349, 232 (easy), 362, 405, 435, then this week Sun 58 + Mon 31, today Tue 13.10 →
 * fitness 47, fatigue 56, form −9, ramp 1. Plus C2's projection (62/70/92, then 330 → −3).
 */

const TODAY = '2026-10-13'; // Tuesday

/** The mockup week shape (Sun quality, Mon easy, Tue quality, Thu tempo, Sat long), scaled. */
const SHAPE = [58, 31, 62, 0, 70, 0, 92];
function week(total: number): number[] {
  const s = SHAPE.reduce((a, b) => a + b, 0);
  const w = SHAPE.map(v => Math.round((total * v) / s));
  w[6] += total - w.reduce((a, b) => a + b, 0);
  return w;
}

/** 12 steady weeks of 300 before the mockup's chart begins (its fitness is 35 in July, not 0). */
function mockupDiary(): LoadRow[] {
  const days: number[] = [];
  for (let i = 0; i < 12; i += 1) days.push(...week(300));
  for (const t of [322, 332, 349, 232, 362, 405]) days.push(...week(t));
  days.push(120, 40, 70, 0, 70, 0, 135); // the 435 week: a big Sunday, a long Saturday
  days.push(58, 31); // this week so far
  const start = shiftDate('2026-08-23', -12 * 7);
  return days.flatMap((load, i) => (load > 0 ? [{ date: shiftDate(start, i), load, source: 'pace' as const }] : []));
}

describe('the EWMA', () => {
  it('uses 42 and 7 days and seeds at 0', () => {
    expect([FITNESS_DAYS, FATIGUE_DAYS]).toEqual([42, 7]);
    const [first] = pmcSeries([{ date: '2026-01-01', load: 84 }]);
    expect(first.fitness).toBeCloseTo(2, 9);
    expect(first.fatigue).toBeCloseTo(12, 9);
  });

  it('fills rest days with 0 and sums a double day', () => {
    const daily = dailyLoads([
      { date: '2026-10-01', load: 40, source: 'pace' },
      { date: '2026-10-01', load: 20, source: 'hr' },
      { date: '2026-10-03', load: 30, source: 'pace' },
      { date: '2026-10-03', load: null, source: 'none' },
    ], '2026-10-01', '2026-10-03');
    expect(daily).toEqual([
      { date: '2026-10-01', load: 60 }, { date: '2026-10-02', load: 0 }, { date: '2026-10-03', load: 30 },
    ]);
  });
});

describe('the mockup\'s numbers', () => {
  const rows = mockupDiary();
  const first = rows[0].date;
  const series = pmcSeries(dailyLoads(rows, first, shiftDate(TODAY, -1)));
  const t = pmcToday(series, TODAY);

  it('fitness 47, fatigue 56, form −9, ramp 1 — as of yesterday', () => {
    expect(Math.abs(t.fitness - 47)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.fatigue - 56)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.form - -9)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.ramp - 1)).toBeLessThanOrEqual(1);
    expect([Math.round(t.fitness), Math.round(t.fatigue), Math.round(t.form), Math.round(t.ramp)]).toEqual([47, 56, -9, 1]);
  });

  it('today\'s run does not change today\'s numbers', () => {
    const withToday = [...rows, { date: TODAY, load: 64, source: 'pace' as const }];
    const s2 = pmcSeries(dailyLoads(withToday, first, TODAY));
    expect(pmcToday(s2, TODAY)).toEqual(t);
  });

  it('decays with zero load when the series stops before yesterday', () => {
    const cut = shiftDate(TODAY, -6);
    const early = rows.filter(r => r.date <= cut);
    const short = pmcSeries(dailyLoads(early, first, cut));
    const full = pmcSeries(dailyLoads(early, first, shiftDate(TODAY, -1)));
    const a = pmcToday(short, TODAY);
    const b = pmcToday(full, TODAY);
    expect(a.fitness).toBeCloseTo(b.fitness, 9);
    expect(a.fatigue).toBeCloseTo(b.fatigue, 9);
    expect(a.ramp).toBeCloseTo(b.ramp, 9);
  });

  it('the coach\'s projection: rest of the week 62/70/92, next week 330 → form about −3', () => {
    const future = [62, 0, 70, 0, 92, ...week(330)].map((load, i) => ({ date: shiftDate(TODAY, i), load }));
    const projected = projectSeries(series, future);
    const end = projected[projected.length - 1];
    expect(end.date).toBe('2026-10-24');
    expect(Math.abs(end.fitness - end.fatigue - -3)).toBeLessThanOrEqual(1);
    expect(Math.round(end.fitness)).toBe(47);
    expect(Math.abs(end.fatigue - 50)).toBeLessThanOrEqual(1);
  });

  it('a low DONE week is not "easy": only the coach\'s plan makes it one', () => {
    const daily = dailyLoads(rows, first, TODAY);
    const weeks = lastWeeks('2026-10-10', 11);
    expect(weeklyLoads(daily, {}, weeks, [], TODAY).some(b => b.easy)).toBe(false);
    const planned = Object.fromEntries(weeks.map(w => [w, w === '2026-09-13' ? 232 : 330]));
    const bars = weeklyLoads(daily, planned, weeks, [], TODAY);
    expect(bars.find(b => b.weekStart === '2026-09-13')).toMatchObject({ done: 232, planned: 232, easy: true });
    expect(bars.filter(b => b.easy).map(b => b.weekStart)).toEqual(['2026-09-13']);
  });

  it('loadWeeks: 8 bars, judged against the 4 weeks before them at their plan', () => {
    const daily = dailyLoads(rows, first, TODAY);
    const all = plannedWeeksFor(TODAY);
    expect(all).toHaveLength(12);
    const bars = loadWeeks(daily, { ...Object.fromEntries(all.map(w => [w, 330])), '2026-10-11': 200 }, TODAY, first);
    expect(bars).toHaveLength(8);
    expect(bars[7]).toMatchObject({ weekStart: '2026-10-11', planned: 200, easy: true });
  });

  it('this week\'s bar is the planned load when there is one, and not easy at 313 vs ~348', () => {
    const daily = dailyLoads(rows, first, TODAY);
    const bars = weeklyLoads(daily, { '2026-10-11': 313 }, lastWeeks(TODAY, 8), [300, 300, 300, 300], TODAY);
    expect(bars.map(b => b.done)).toEqual([322, 332, 349, 232, 362, 405, 435, 89]);
    expect(bars[7]).toMatchObject({ weekStart: '2026-10-11', planned: 313, easy: false });
  });

  it('an unplanned week still running is never easy on its partial total', () => {
    const daily = dailyLoads(rows, first, TODAY);
    const bars = weeklyLoads(daily, {}, lastWeeks(TODAY, 8), [], TODAY);
    expect(bars[7]).toMatchObject({ done: 89, planned: null, easy: false });
  });
});

describe('isEasyWeek', () => {
  it('is ≤ 0.75 × the mean of the previous 4 weeks', () => {
    expect(isEasyWeek(232, [300, 322, 332, 349])).toBe(true);
    expect(isEasyWeek(250, [300, 322, 332, 349])).toBe(false);
    expect(isEasyWeek(100, [])).toBe(false);
  });
});

describe('loadStatus', () => {
  const pace = (date: string, load: number | null = 50, source: LoadRow['source'] = 'pace'): LoadRow => ({ date, load, source });

  it('19 days since the first priced run → learning, 23 days left', () => {
    const rows = [pace(shiftDate(TODAY, -19)), pace(shiftDate(TODAY, -10))];
    expect(loadStatus(rows, TODAY)).toEqual({ kind: 'learning', daysLeft: 23, daysSeen: 19 });
  });

  it('42 days → ok', () => {
    expect(loadStatus([pace(shiftDate(TODAY, -42))], TODAY)).toEqual({ kind: 'ok' });
  });

  it('more than 20% of the last 42 days\' runs unpriced → insufficient; not_run does not count', () => {
    const base = Array.from({ length: 8 }, (_, i) => pace(shiftDate(TODAY, -60 + i * 7)));
    const none = [pace(shiftDate(TODAY, -3), null, 'none'), pace(shiftDate(TODAY, -2), null, 'none')];
    expect(loadStatus([...base, ...none], TODAY)).toEqual({ kind: 'insufficient' });
    const bikes = Array.from({ length: 10 }, (_, i) => pace(shiftDate(TODAY, -i - 1), null, 'not_run'));
    expect(loadStatus([...base, none[0], ...bikes], TODAY)).toEqual({ kind: 'ok' });
  });

  it('runs and none of them priced → learning while the first is under 42 days old, then insufficient', () => {
    expect(loadStatus([pace(shiftDate(TODAY, -3), null, 'none')], TODAY)).toEqual({ kind: 'learning', daysLeft: 39, daysSeen: 3 });
    expect(loadStatus([pace(shiftDate(TODAY, -50), null, 'none')], TODAY)).toEqual({ kind: 'insufficient' });
    expect(loadStatus([], TODAY)).toEqual({ kind: 'learning', daysLeft: 42, daysSeen: 0 });
  });

  it('a new trainee with 2 unpriced runs out of 3 is learning, not insufficient', () => {
    const rows = [pace(shiftDate(TODAY, -10), null, 'none'), pace(shiftDate(TODAY, -6), null, 'none'), pace(shiftDate(TODAY, -2))];
    expect(loadStatus(rows, TODAY)).toEqual({ kind: 'learning', daysLeft: 40, daysSeen: 2 });
  });
});

describe('weeks', () => {
  it('start on Sunday', () => {
    expect(weekStartOf('2026-10-13')).toBe('2026-10-11');
    expect(weekStartOf('2026-10-11')).toBe('2026-10-11');
    expect(weekStartOf('2026-10-17')).toBe('2026-10-11');
    expect(lastWeeks('2026-10-13', 3)).toEqual(['2026-09-27', '2026-10-04', '2026-10-11']);
  });
});
