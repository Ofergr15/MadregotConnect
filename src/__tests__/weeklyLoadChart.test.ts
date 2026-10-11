import { describe, expect, it } from 'vitest';
import { compareToAverage, nearestBar, weeklyLoadChart, weeklySentence } from '@/lib/charts/weekly-load';

/**
 * The month board's weekly ⚡ bars (trainee-experience-v2 screen 3). The mockup's eight
 * weeks: 322 332 349 232 362 405 435 and this week 89 done of 313 planned; the 232 week is
 * the easy one; the average of the complete weeks is 348.
 */

const STARTS = ['2026-08-23', '2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11'];
const DONE = [322, 332, 349, 232, 362, 405, 435, 89];
const WEEKLY = STARTS.map((weekStart, i) => ({
  weekStart, done: DONE[i], planned: i === 7 ? 313 : null, easy: i === 3,
}));

describe('weeklyLoadChart — time runs left to right (G1)', () => {
  const chart = weeklyLoadChart(WEEKLY);

  it('the oldest week is on the far left and this week on the far right', () => {
    const xs = chart.bars.map(b => b.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    expect(chart.bars[0].weekStart).toBe('2026-08-23');
    expect(chart.bars[7]).toMatchObject({ weekStart: '2026-10-11', isNow: true, tone: 'now' });
    // Inside the box, half a bar (and 2px) from each edge.
    expect(xs[0]).toBeCloseTo(16);
    expect(xs[7]).toBeCloseTo(326 - 16);
  });

  it('this week is solid done inside a dashed planned frame; the easy week is tinted', () => {
    const now = chart.bars[7];
    expect(now.planned).toMatchObject({ value: 313 });
    expect(now.planned!.h).toBeGreaterThan(now.h);
    expect(chart.bars[3].tone).toBe('easy');
    expect(chart.bars.filter(b => b.planned).length).toBe(1);
  });

  it('a taller load is a taller bar; the average is of the complete weeks: 348', () => {
    expect(chart.bars[6].h).toBeGreaterThan(chart.bars[5].h);
    expect(chart.avg).toBe(348);
    expect(chart.avgY).toBeGreaterThan(chart.bars[6].y);
    expect(chart.avgY).toBeLessThan(chart.bars[3].y);
  });

  it('lays out at the measured width', () => {
    const wide = weeklyLoadChart(WEEKLY, { width: 400 });
    expect(wide.bars[7].x).toBeCloseTo(400 - 16);
  });

  it('no average line with fewer than two complete weeks', () => {
    expect(weeklyLoadChart(WEEKLY.slice(-2)).avg).toBeNull();
  });
});

describe('weeklySentence — planned against the average', () => {
  it('the mockup: 313 a little below 348, after a heavy week, with an easy week shown', () => {
    expect(weeklySentence(WEEKLY)).toEqual({
      key: 'vs.below', params: { planned: 313, avg: 348 }, afterHeavy: true, easyShown: true, easyNow: false,
    });
  });

  it('no plan this week: what is done so far against the average', () => {
    const noPlan = WEEKLY.map((w, i) => (i === 7 ? { ...w, planned: null } : w));
    expect(weeklySentence(noPlan)).toMatchObject({ key: 'noPlan', params: { done: 89, avg: 348 }, afterHeavy: false });
  });

  it('nothing to compare with: no sentence', () => {
    expect(weeklySentence(WEEKLY.slice(-2))).toBeNull();
  });

  it('five words, ±5% is the same', () => {
    expect(compareToAverage(290, 348)).toBe('wellBelow');
    expect(compareToAverage(313, 348)).toBe('below');
    expect(compareToAverage(350, 348)).toBe('same');
    expect(compareToAverage(380, 348)).toBe('above');
    expect(compareToAverage(420, 348)).toBe('wellAbove');
  });
});

describe('a planned easy THIS week, and the tap (M2)', () => {
  const easyNow = WEEKLY.map((w, i) => (i === 7 ? { ...w, planned: 200, easy: true } : { ...w, easy: false }));

  it('this week stays in its own colour; its dashed frame carries the easy mark and the sentence says so', () => {
    const chart = weeklyLoadChart(easyNow);
    expect(chart.bars[7]).toMatchObject({ tone: 'now', easy: true, plannedValue: 200 });
    expect(chart.bars[7].planned?.value).toBe(200);
    const s = weeklySentence(easyNow)!;
    expect(s).toMatchObject({ easyNow: true, easyShown: false });
  });

  it('a tap anywhere picks the nearest bar', () => {
    const chart = weeklyLoadChart(WEEKLY);
    expect(nearestBar(chart, 0)).toBe(0);
    expect(nearestBar(chart, 326)).toBe(7);
    expect(nearestBar(chart, chart.bars[3].x + 5)).toBe(3);
  });
});
