import { describe, it, expect } from 'vitest';
import { parseTime, formatTime } from '../lib/academy/benchmark';

describe('parseTime', () => {
  it('parses M:SS.ss', () => {
    expect(parseTime('5:46.96')).toBeCloseTo(346.96);
  });
  it('parses M:SS.s', () => {
    expect(parseTime('5:49.0')).toBeCloseTo(349.0);
  });
  it('parses M:SS with no decimals', () => {
    expect(parseTime('5:54')).toBe(354);
    expect(parseTime('6:03')).toBe(363);
  });
  it('parses bare seconds', () => {
    expect(parseTime('346.96')).toBeCloseTo(346.96);
  });
  it('parses H:MM:SS', () => {
    expect(parseTime('1:02:30')).toBe(3750);
  });
  it('trims whitespace', () => {
    expect(parseTime('  6:10.03 ')).toBeCloseTo(370.03);
  });
  it('returns null for junk', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('5:xx')).toBeNull();
  });
});

describe('formatTime', () => {
  it('formats with two fractional digits', () => {
    expect(formatTime(346.96)).toBe('5:46.96');
  });
  it('trims trailing zero in fraction', () => {
    expect(formatTime(349.0)).toBe('5:49');
    expect(formatTime(349.1)).toBe('5:49.1');
    expect(formatTime(349.10)).toBe('5:49.1');
  });
  it('pads seconds', () => {
    expect(formatTime(363)).toBe('6:03');
    expect(formatTime(354)).toBe('5:54');
  });
  it('formats hours', () => {
    expect(formatTime(3750)).toBe('1:02:30');
  });
  it('round-trips parse→format for the sheet values', () => {
    for (const t of ['5:46.96', '5:49', '5:54', '6:03', '6:10.03', '7:13.8']) {
      expect(formatTime(parseTime(t)!)).toBe(t);
    }
  });
  it('handles invalid input', () => {
    expect(formatTime(NaN)).toBe('');
    expect(formatTime(-5)).toBe('');
  });
});
