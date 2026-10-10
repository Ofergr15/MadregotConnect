import { describe, expect, it } from 'vitest';
import { shiftDate } from '@/lib/academy/load';
import {
  fmtSleep, isLearning, normalRange, percentile, rhrStreak, rhrVerdict, sleepVerdict, RHR_HIGH_RULE,
  type NormalRange, type WellnessNight,
} from '@/lib/academy/normal-range';

/** The normal range (spec §3.5) on mockup 8's 30 mornings: P25 46, P75 50, five above. */

const TODAY = '2026-10-13';
// Mockup 8, oldest first; the last one is this morning.
const RHR = [47, 48, 46, 45, 51, 49, 47, 46, 44, 48, 50, 52, 47, 46, 45, 48, 51, 46, 47, 45, 50, 44, 52, 48, 46, 51, 49, 50, 48, 51];
const nights: WellnessNight[] = RHR.map((v, i) => ({ date: shiftDate(TODAY, i - (RHR.length - 1)), resting_hr: v, sleep_seconds: 25_000 + i * 20 }));

describe('normalRange', () => {
  const range = normalRange(nights, TODAY, 'resting_hr') as NormalRange;

  it('the 29 earlier mornings give P25 = 46 and P75 = 50 (today excluded)', () => {
    expect(isLearning(range)).toBe(false);
    expect(range).toMatchObject({ lo: 46, hi: 50, n: 29 });
  });

  it('five of them sit above the range', () => {
    expect(RHR.slice(0, 29).filter(v => v > range.hi)).toHaveLength(5);
  });

  it('needs 14 values; with fewer it is learning, with the nights still missing', () => {
    const few = nights.slice(-11); // 10 before today + today
    expect(normalRange(few, TODAY, 'resting_hr')).toEqual({ learning: 4 });
  });

  it('skips missing nights and ignores anything older than 30 days', () => {
    const holes = nights.map((n, i) => (i % 2 ? { ...n, resting_hr: null } : n));
    const old = [{ date: shiftDate(TODAY, -45), resting_hr: 90 }];
    const r = normalRange([...old, ...holes], TODAY, 'resting_hr') as NormalRange;
    expect(r.n).toBe(15); // every other morning of the 29, the 90 from 45 days ago not among them
    expect(r.hi).toBeLessThanOrEqual(52);
    expect(normalRange(holes.slice(-26), TODAY, 'resting_hr')).toEqual({ learning: 1 });
  });

  it('percentile is linear (type 7)', () => {
    expect(percentile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 9);
    expect(percentile([10], 0.75)).toBe(10);
  });
});

describe('verdicts', () => {
  const range = normalRange(nights, TODAY, 'resting_hr');

  it('RHR: 51 a bit high, 56 high, 45 low ✓, 48 normal', () => {
    expect(RHR_HIGH_RULE).toBe('p75');
    expect(rhrVerdict(51, range)).toBe('bitHigh');
    expect(rhrVerdict(55, range)).toBe('bitHigh');
    expect(rhrVerdict(56, range)).toBe('high');
    expect(rhrVerdict(45, range)).toBe('low');
    expect(rhrVerdict(48, range)).toBe('normal');
    expect(rhrVerdict(null, range)).toBeNull();
    expect(rhrVerdict(51, { learning: 3 })).toBeNull();
  });

  it('sleep: less, very little (45 min under), more is ✓ never a warning', () => {
    const r: NormalRange = { lo: 6 * 3600 + 40 * 60, hi: 7 * 3600 + 50 * 60, n: 20, mean: 0, sd: 0 };
    expect(sleepVerdict(7 * 3600 + 12 * 60, r)).toBe('normal');
    expect(sleepVerdict(6 * 3600 + 30 * 60, r)).toBe('less');
    expect(sleepVerdict(5 * 3600 + 50 * 60, r)).toBe('veryLittle');
    expect(sleepVerdict(8 * 3600 + 30 * 60, r)).toBe('more');
  });

  it('fmtSleep prints h:mm', () => {
    expect(fmtSleep(7 * 3600 + 12 * 60)).toBe('7:12');
    expect(fmtSleep(6 * 3600 + 58 * 60 + 40)).toBe('6:59');
  });
});

describe('rhrStreak — the 3-morning rule', () => {
  const range: NormalRange = { lo: 46, hi: 50, n: 29, mean: 48, sd: 2 };
  const seq = (values: Array<number | null>) => values.map((v, i) => ({ date: shiftDate(TODAY, i - values.length + 1), resting_hr: v }));

  it('3 mornings in a row above set the flag', () => {
    expect(rhrStreak(seq([48, 51, 52, 53]), range)).toEqual({ flag: true, aboveRun: 3 });
    expect(rhrStreak(seq([51, 52, 48, 53]), range).flag).toBe(false);
  });

  it('2 mornings back inside clear it; 1 does not', () => {
    expect(rhrStreak(seq([51, 52, 53, 48]), range)).toEqual({ flag: true, aboveRun: 0 });
    expect(rhrStreak(seq([51, 52, 53, 48, 47]), range).flag).toBe(false);
    expect(rhrStreak(seq([51, 52, 53, 45, 44]), range).flag).toBe(false);
  });

  it('a missing morning neither breaks nor counts', () => {
    expect(rhrStreak(seq([51, null, 52, null, 53]), range)).toEqual({ flag: true, aboveRun: 3 });
    expect(rhrStreak(seq([51, 52, 53, 48, null, 47]), range).flag).toBe(false);
  });

  it('is off while learning', () => {
    expect(rhrStreak(seq([60, 60, 60]), { learning: 5 })).toEqual({ flag: false, aboveRun: 0 });
  });
});
