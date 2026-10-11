import { describe, expect, it } from 'vitest';
import {
  entryPreview, entryRow, formDate, measuredText, parseAvgHr, parseClockSec, parseDistanceM,
} from '@/lib/academy/test-entry';

/**
 * The one typed number of a test (mockup academy-existing-trainees, phones 2 and 4) and the
 * threshold it shows while typing. The form and the trainee's card share this, so "7.12" can
 * never mean 7.12 km on one screen and 7 metres on the other.
 */

describe('parseDistanceM', () => {
  it('reads km with a dot or a comma, and whole metres', () => {
    expect(parseDistanceM('7.12')).toBe(7120);
    expect(parseDistanceM('7,12')).toBe(7120);
    expect(parseDistanceM('7120')).toBe(7120);
    expect(parseDistanceM(' 6.4 ק״מ')).toBe(6400);
  });
  it('anything above 100 is metres: nobody runs 100 km in 30 minutes', () => {
    expect(parseDistanceM('100')).toBe(100_000);
    expect(parseDistanceM('101')).toBe(101);
  });
  it('blank, zero and junk are no number', () => {
    for (const v of ['', '0', '.', 'abc', '7.1.2']) expect(parseDistanceM(v)).toBeNull();
  });
});

describe('parseClockSec', () => {
  it('reads m:ss, m:ss.s, h:mm:ss and bare seconds', () => {
    expect(parseClockSec('7:05')).toBe(425);
    expect(parseClockSec('7:05.4')).toBeCloseTo(425.4);
    expect(parseClockSec('1:02:03')).toBe(3723);
    expect(parseClockSec('425')).toBe(425);
    expect(parseClockSec("7'05")).toBe(425);
  });
  it('refuses a seconds field of 60 or more, and junk', () => {
    expect(parseClockSec('7:60')).toBeNull();
    expect(parseClockSec('1:60:00')).toBeNull();
    expect(parseClockSec('abc')).toBeNull();
    expect(parseClockSec('')).toBeNull();
  });
});

describe('parseAvgHr', () => {
  it('blank is no answer; out of 80-230 is invalid, as migration 105 checks', () => {
    expect(parseAvgHr('')).toBeNull();
    expect(parseAvgHr('171')).toBe(171);
    expect(parseAvgHr('79')).toBe('invalid');
    expect(parseAvgHr('231')).toBe('invalid');
    expect(parseAvgHr('17.5')).toBe('invalid');
  });
});

describe('entryRow / entryPreview', () => {
  it('a 30-minute test fixes the clock and measures the distance: 7.12 km → 4:13', () => {
    expect(entryRow('30min', '7.12')).toEqual({ protocol: '30min', durationSec: 1800, distanceM: 7120 });
    const p = entryPreview('30min', '7.12');
    expect(p.thresholdSec).toBe(253); // 1800 / 7.12 = 252.8 → 4:13, the mockup's number
    expect(p.implausible).toBe(false);
  });
  it('a 2000 m fixes the distance and measures the clock — and gives NO threshold', () => {
    expect(entryRow('2000m', '7:05')).toEqual({ protocol: '2000m', durationSec: 425, distanceM: 2000 });
    const p = entryPreview('2000m', '7:05');
    expect(p.effortPaceSec).toBe(213);
    // DECIDED in test-state.ts: a 2000 m pace as a threshold makes every zone too fast.
    expect(p.thresholdSec).toBeNull();
  });
  it('nothing typed yet is no row and no pace, not a 0:00', () => {
    const p = entryPreview('30min', '');
    expect(p.row).toBeNull();
    expect(p.thresholdSec).toBeNull();
    expect(p.implausible).toBe(false);
  });
  it('flags a pace no human runs: 0.7 km (a walk) or 15 km (2:00/km) in 30 minutes', () => {
    expect(entryPreview('30min', '0.7').implausible).toBe(true);
    expect(entryPreview('30min', '15').implausible).toBe(true); // 2:00/km
  });
});

describe('formDate / measuredText', () => {
  it('the form shows dd.mm.yyyy and the stored halves back as typed', () => {
    expect(formDate('2026-09-14')).toBe('14.09.2026');
    expect(measuredText({ protocol: '30min', durationSec: 1800, distanceM: 7120 })).toBe('7.12');
    expect(measuredText({ protocol: '2000m', durationSec: 425, distanceM: 2000 })).toBe('7:05');
  });
});
