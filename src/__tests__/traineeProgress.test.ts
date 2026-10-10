import { describe, expect, it } from 'vitest';
import { shiftDate } from '@/lib/academy/load';
import { buildLoadPayload } from '@/lib/academy/load-payload';
import type { LoadRow } from '@/lib/academy/pmc';
import {
  RAMP_BANDS, fitnessChart, formStrip, progressView, rampBandOf, rampSentence, rangeOptions, sinceFirstTest, thresholdRow,
} from '@/lib/academy/progress';

/**
 * "התקדמות" (trainee-experience-v2 screens 7, 7ב, 7ג): what the page reads off the URL, the
 * chart's geometry (time runs left → right, so built fitness climbs toward "היום"), the
 * form strip, the ramp sentence and the threshold row — plus the load payload's fields
 * that feed them.
 */

const TODAY = '2026-10-13';
const TESTS = [
  { date: '2026-03-10', thresholdSec: 278 }, { date: '2026-05-12', thresholdSec: 270 },
  { date: '2026-07-10', thresholdSec: 261 }, { date: '2026-09-16', thresholdSec: 252 },
];

/** A build: a run every other day whose load grows, so fitness rises through the range. */
function building(days = 130): LoadRow[] {
  const rows: LoadRow[] = [];
  for (let i = days; i >= 1; i -= 2) rows.push({ date: shiftDate(TODAY, -i), load: 40 + (days - i) * 0.4, source: 'pace' });
  return rows;
}

describe('the page', () => {
  it('?view= picks the screen', () => {
    expect(progressView(null)).toBe('progress');
    expect(progressView('tests')).toBe('tests');
    expect(progressView('body')).toBe('body');
    expect(progressView('nonsense')).toBe('progress');
  });

  it('"עד המרוץ" only with a race ahead', () => {
    expect(rangeOptions(null)).toEqual(['6w', '3m']);
    expect(rangeOptions('2026-12-06')).toEqual(['6w', '3m', 'race']);
  });
});

describe('the load payload behind screen 7', () => {
  const p = buildLoadPayload({ rows: building(), tests: TESTS, today: TODAY, range: '3m', raceDate: '2026-12-06' });

  it('one form cell per Sunday week of the range, oldest first, this week last', () => {
    expect(p.formWeeks.length).toBeGreaterThanOrEqual(13);
    expect(p.formWeeks.length).toBeLessThanOrEqual(15);
    const starts = p.formWeeks.map(w => w.weekStart);
    expect([...starts].sort()).toEqual(starts);
    expect(starts[starts.length - 1]).toBe('2026-10-11');
    // This week's cell is today's form (as of yesterday).
    expect(p.formWeeks[p.formWeeks.length - 1].form).toBe(p.today!.form);
    expect(p.formWeeks.every(w => typeof w.band === 'string')).toBe(true);
  });

  it('the previous test, for "4:12 במקום 4:21", and the race', () => {
    expect(p.previousTest).toEqual({ date: '2026-07-10', thresholdSec: 261 });
    expect(p.raceDate).toBe('2026-12-06');
    expect(buildLoadPayload({ rows: building(), tests: TESTS, today: TODAY, range: '3m', raceDate: '2026-01-01' }).raceDate).toBeNull();
  });

  it('no cells while learning', () => {
    expect(buildLoadPayload({ rows: building(20), tests: TESTS, today: TODAY, range: '3m' }).formWeeks).toEqual([]);
  });
});

describe('fitnessChart', () => {
  const p = buildLoadPayload({ rows: building(), tests: TESTS, today: TODAY, range: '3m' });
  const g = fitnessChart(p.series, { width: 326, height: 150 })!;

  it('time runs LEFT → RIGHT and built fitness RISES toward today', () => {
    const xs = [...g.fitnessPath.matchAll(/(?:M|C[^ ]+ [^ ]+ [^ ]+ [^ ]+) ?([\d.]+) ([\d.]+)/g)];
    expect(xs.length).toBeGreaterThan(2);
    // The path starts at the left and ends at today on the right.
    expect(g.fitnessPath.startsWith('M14.0')).toBe(true);
    expect(g.end.x).toBeCloseTo(326 - 12, 0);
    // Higher fitness is higher up: the end point is above the start.
    const startY = Number(/^M[\d.]+ ([\d.]+)/.exec(g.fitnessPath)![1]);
    expect(g.end.fitnessY).toBeLessThan(startY);
    expect(g.end.fitness).toBe(Math.round(p.series[p.series.length - 1].fitness));
  });

  it('labels: months as HTML, "היום" last at the right', () => {
    const last = g.labels[g.labels.length - 1];
    expect(last).toMatchObject({ kind: 'today', align: 'end' });
    expect(g.labels[0]).toMatchObject({ kind: 'month', align: 'start' });
    const xs = g.labels.map(l => l.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    // No month label crowding "היום".
    expect(g.labels.slice(0, -1).every(l => last.x - l.x >= 44)).toBe(true);
  });

  it('nothing to draw with fewer than two points', () => {
    expect(fitnessChart([])).toBeNull();
    expect(fitnessChart([{ date: TODAY, fitness: 1, fatigue: 1 }])).toBeNull();
  });
});

describe('formStrip', () => {
  it('equal cells, the last one outlined, today\'s band as the word', () => {
    const s = formStrip([
      { weekStart: '2026-09-27', form: -13, band: 'working' },
      { weekStart: '2026-10-04', form: -3, band: 'maintain' },
      { weekStart: '2026-10-11', form: -9, band: 'maintain' },
    ])!;
    expect(s.cells.map(c => c.current)).toEqual([false, false, true]);
    expect(s.band).toBe('maintain');
    expect(formStrip([])).toBeNull();
  });
});

describe('rampSentence', () => {
  const p = buildLoadPayload({ rows: building(), tests: TESTS, today: TODAY, range: '3m' });

  it('up N in the last week, and how far since the range began', () => {
    const r = rampSentence(p)!;
    expect(r.key).toBe(p.today!.ramp > 0 ? 'up' : p.today!.ramp < 0 ? 'down' : 'flat');
    expect(r.n).toBe(Math.abs(p.today!.ramp));
    expect(r.since!.date).toBe(p.series[0].date);
    expect(r.since!.rise).toBe(Math.round(p.today!.fitness - p.series[0].fitness));
    expect(r.since!.rise).toBeGreaterThan(0);
  });

  it('"אחרי שבוע עמוס" when last week was heavy against the four before', () => {
    const base = { today: { fitness: 47, fatigue: 56, form: -9, ramp: 1, band: 'maintain' as const, rampWord: 'maintaining' as const }, series: [] };
    const weekly = [322, 332, 349, 232, 362, 405, 435, 89].map((done, i) => ({ weekStart: shiftDate('2026-08-23', 7 * i), done, planned: null, easy: false }));
    expect(rampSentence({ ...base, weekly })!.afterHeavy).toBe(true);
    const flat = weekly.map(w => ({ ...w, done: 300 }));
    expect(rampSentence({ ...base, weekly: flat })!.afterHeavy).toBe(false);
    expect(rampSentence({ ...base, today: null, weekly })).toBeNull();
  });
});

describe('the threshold row and 7ג', () => {
  it('"4:12 במקום 4:21", 9 seconds faster', () => {
    expect(thresholdRow({ thresholdSec: 252, basisTestDate: '2026-09-16', previousTest: { date: '2026-07-10', thresholdSec: 261 } }))
      .toEqual({ paceSec: 252, testDate: '2026-09-16', previous: { paceSec: 261, date: '2026-07-10', fasterBy: 9 } });
    expect(thresholdRow({ thresholdSec: 252, basisTestDate: '2026-09-16', previousTest: null })!.previous).toBeNull();
    expect(thresholdRow({ thresholdSec: null, basisTestDate: null, previousTest: null })).toBeNull();
  });

  it('"▲ 26 שנ׳ מאז מרץ": the first counted test against the latest', () => {
    expect(sinceFirstTest([
      { date: '2026-03-10', paceSec: 278 }, { date: '2026-05-12', paceSec: null },
      { date: '2026-07-10', paceSec: 261 }, { date: '2026-09-16', paceSec: 252 },
    ])).toEqual({ fasterBy: 26, since: '2026-03-10' });
    expect(sinceFirstTest([{ date: '2026-09-16', paceSec: 252 }])).toBeNull();
  });
});

describe('7ב: the ramp bands', () => {
  it('≥9 too fast, 5…8 building, 0…4 maintaining, ≤−1 recovering — every integer in exactly one', () => {
    expect([9, 8, 5, 4, 0, -1].map(rampBandOf)).toEqual(['tooFast', 'building', 'building', 'maintaining', 'maintaining', 'recovering']);
    for (let r = -15; r <= 20; r += 1) {
      const hits = RAMP_BANDS.filter(b => (b.min == null || r >= b.min) && (b.max == null || r <= b.max));
      expect(hits.map(b => b.key)).toEqual([rampBandOf(r)]);
    }
  });
});
