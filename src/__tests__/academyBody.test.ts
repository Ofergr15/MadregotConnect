import { describe, expect, it } from 'vitest';
import { buildBodyPayload, featuredMetric, rangeChart, rhrAdvice } from '@/lib/academy/body';
import { normalRange } from '@/lib/academy/normal-range';

/**
 * The body screen's numbers (trainee-experience-v2 screen 8): resting HR and sleep against
 * the trainee's own range, the 3-morning sentence, the feel row, which chart comes first,
 * and the chart's dots — oldest left, only the bad side orange.
 */

const TODAY = '2026-10-13';
const day = (offset: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

// The mockup's 30 mornings, oldest first; the last is this morning's 51.
const MOCK = [47, 48, 46, 45, 51, 49, 47, 46, 44, 48, 50, 52, 47, 46, 45, 48, 51, 46, 47, 45, 50, 44, 52, 48, 46, 51, 49, 50, 48, 51];
const nights = (values = MOCK, sleep = (i: number) => 25200 + (i % 5) * 900) =>
  values.map((v, i) => ({ date: day(i - (values.length - 1)), resting_hr: v, sleep_seconds: sleep(i) }));

describe('buildBodyPayload', () => {
  it('this morning\'s resting HR against 46–50: a bit high, featured, "זה קורה"', () => {
    const p = buildBodyPayload({ nights: nights(), today: TODAY, feedback: [] });
    expect(p.rhr.latest).toEqual({ date: TODAY, value: 51 });
    expect(p.rhr.isToday).toBe(true);
    expect(p.rhr.range).toMatchObject({ lo: 46, hi: 50 });
    expect(p.rhr.verdict).toBe('bitHigh');
    // Yesterday 48 was inside, so one morning above: no flag, the "it happens" sentence.
    expect(p.rhr.streak).toEqual({ flag: false, aboveRun: 1 });
    expect(p.rhr.advice).toBe('once');
    expect(p.featured).toBe('rhr');
    expect(p.rhr.series).toHaveLength(30);
  });

  it('a morning not synced yet: the newest stored one, named by its date, judged on the 30 before it', () => {
    const p = buildBodyPayload({ nights: nights().slice(0, -1), today: TODAY, feedback: [] });
    expect(p.rhr.latest).toEqual({ date: day(-1), value: 48 });
    expect(p.rhr.isToday).toBe(false);
    expect(p.rhr.verdict).toBe('normal');
  });

  it('learning with fewer than 14 nights: no verdict, no advice', () => {
    const p = buildBodyPayload({ nights: nights(MOCK.slice(-10)), today: TODAY, feedback: [] });
    expect(p.rhr.range).toEqual({ learning: 5 });
    expect(p.rhr.verdict).toBeNull();
    expect(p.rhr.advice).toBeNull();
  });

  it('the feel row: the mean of the newest 4 answers, the face, the effort to one decimal', () => {
    const p = buildBodyPayload({
      nights: [], today: TODAY,
      feedback: [
        { feel: 3, difficulty: 7, created_at: '2026-10-12T08:00:00Z' },
        { feel: 3, difficulty: 6, created_at: '2026-10-10T08:00:00Z' },
        { feel: 4, difficulty: 7, created_at: '2026-10-08T08:00:00Z' },
        { feel: 2, difficulty: 6, created_at: '2026-10-06T08:00:00Z' },
        { feel: 0, difficulty: 10, created_at: '2026-09-01T08:00:00Z' }, // fifth: left out
        { feel: null, difficulty: 3, created_at: '2026-10-13T08:00:00Z' }, // no feel: not an answer
      ],
    });
    expect(p.feel).toMatchObject({ avg: 3, face: 3, effort: 6.5, n: 4 });
    expect(p.feel!.recent.map(r => r.date)).toEqual(['2026-10-06', '2026-10-08', '2026-10-10', '2026-10-12']);
    // No nights and a feel: the feel is what is shown.
    expect(p.featured).toBe('feel');
  });

  it('no answers: no feel row', () => {
    expect(buildBodyPayload({ nights: [], today: TODAY, feedback: [] }).feel).toBeNull();
  });
});

describe('which chart first', () => {
  it('a high RHR, then a short night, else the RHR', () => {
    const p = buildBodyPayload({ nights: nights(), today: TODAY, feedback: [] });
    expect(featuredMetric(p)).toBe('rhr');
    const calm = [...MOCK.slice(0, -1), 47];
    const short = buildBodyPayload({ nights: nights(calm, i => (i === 29 ? 18000 : 25200 + (i % 5) * 900)), today: TODAY, feedback: [] });
    expect(short.sleep.verdict).toBe('veryLittle');
    expect(short.featured).toBe('sleep');
    expect(buildBodyPayload({ nights: nights(calm), today: TODAY, feedback: [] }).featured).toBe('rhr');
  });
});

describe('the 3-morning sentence', () => {
  const learned = normalRange(nights(), TODAY, 'resting_hr');
  it('three above → lower the intensity; two → one more; one → it happens; none → inside', () => {
    expect(rhrAdvice({ flag: true, aboveRun: 3 }, learned)).toBe('streak');
    expect(rhrAdvice({ flag: true, aboveRun: 0 }, learned)).toBe('streak');
    expect(rhrAdvice({ flag: false, aboveRun: 2 }, learned)).toBe('twice');
    expect(rhrAdvice({ flag: false, aboveRun: 1 }, learned)).toBe('once');
    expect(rhrAdvice({ flag: false, aboveRun: 0 }, learned)).toBe('inside');
    expect(rhrAdvice({ flag: false, aboveRun: 0 }, { learning: 3 })).toBeNull();
  });

  it('three high mornings in a row raise the flag', () => {
    const p = buildBodyPayload({ nights: nights([...MOCK.slice(0, -3), 53, 54, 58]), today: TODAY, feedback: [] });
    expect(p.rhr.streak.flag).toBe(true);
    expect(p.rhr.advice).toBe('streak');
    expect(p.rhr.verdict).toBe('high');
  });
});

describe('rangeChart', () => {
  it('oldest LEFT, today right; five orange mornings above 46–50 before this morning\'s', () => {
    const p = buildBodyPayload({ nights: nights(), today: TODAY, feedback: [] });
    const g = rangeChart(p.rhr.series, p.rhr.range, 'rhr', TODAY)!;
    expect(g.dots[0].x).toBeLessThan(g.dots[g.dots.length - 1].x);
    const latest = g.dots.filter(d => d.latest);
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ date: TODAY, value: 51, out: true });
    expect(g.dots.filter(d => d.out && !d.latest)).toHaveLength(5);
    // Below the band (44, 45) is good news: grey.
    expect(g.dots.filter(d => d.value < 46).every(d => !d.out)).toBe(true);
    // The band is drawn above 46 and below 50 — higher values are higher up.
    expect(g.band!.y).toBeLessThan(g.band!.y + g.band!.h);
    expect(g.dots.find(d => d.value === 52)!.y).toBeLessThan(g.dots.find(d => d.value === 44)!.y);
    // The mockup's two gridlines over 42…56.
    expect(g.grid.map(l => l.value)).toEqual([45, 55]);
  });

  it('sleep: only the short nights are coloured', () => {
    const p = buildBodyPayload({ nights: nights(MOCK, i => (i === 10 ? 16000 : 25200 + (i % 5) * 900)), today: TODAY, feedback: [] });
    const g = rangeChart(p.sleep.series, p.sleep.range, 'sleep', TODAY)!;
    const out = g.dots.filter(d => d.out);
    expect(out.every(d => d.value < (p.sleep.range as { lo: number }).lo)).toBe(true);
    expect(out.map(d => d.value)).toContain(16000);
  });

  it('a missing morning leaves a gap rather than closing up', () => {
    const series = [{ date: day(-29), value: 47 }, { date: day(-1), value: 48 }, { date: TODAY, value: 49 }];
    const g = rangeChart(series, { learning: 11 }, 'rhr', TODAY)!;
    const step = g.dots[2].x - g.dots[1].x;
    expect(g.dots[1].x - g.dots[0].x).toBeCloseTo(step * 28, 0);
    expect(g.band).toBeNull();
    expect(rangeChart([], { learning: 14 }, 'rhr', TODAY)).toBeNull();
  });
});
