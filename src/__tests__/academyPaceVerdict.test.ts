import { describe, expect, it } from 'vitest';
import {
  amountLook, amountVerdict, distancePillText, fmtClock, fmtKm, fmtPace, pacePillText, paceVerdict, timePillText,
} from '@/lib/academy/pace-verdict';

/**
 * The pace rule every trainee screen draws with. The tolerance DECIDES on/off; the
 * printed delta is measured from the band the coach wrote — "4:03 against 4:10 is
 * 7 seconds fast", not "2 seconds outside a ±5 window".
 */

describe('paceVerdict', () => {
  it('is on plan inside the band widened by the tolerance', () => {
    expect(paceVerdict(250, 250, 250, 5)).toEqual({ kind: 'on', deltaSec: 0 });
    expect(paceVerdict(245, 250, 250, 5)).toEqual({ kind: 'on', deltaSec: 0 });
    expect(paceVerdict(255, 250, 250, 5)).toEqual({ kind: 'on', deltaSec: 0 });
  });

  it('measures the delta from the planned target, not from the tolerance edge', () => {
    expect(paceVerdict(243, 250, 250, 5)).toEqual({ kind: 'fast', deltaSec: 7 });
    expect(paceVerdict(259, 250, 250, 5)).toEqual({ kind: 'slow', deltaSec: 9 });
  });

  it('measures a range target from its nearer edge', () => {
    expect(paceVerdict(358, 335, 340, 5)).toEqual({ kind: 'slow', deltaSec: 18 });
    expect(paceVerdict(320, 335, 340, 5)).toEqual({ kind: 'fast', deltaSec: 15 });
  });

  it('reads a band given backwards, and a one-sided target', () => {
    expect(paceVerdict(259, 260, 250, 0)).toEqual({ kind: 'on', deltaSec: 0 });
    expect(paceVerdict(240, 250, null, 5)).toEqual({ kind: 'fast', deltaSec: 10 });
  });

  it('has no verdict without a target or without a pace — no target is not "on plan"', () => {
    expect(paceVerdict(250, null, null, 5)).toBeNull();
    expect(paceVerdict(null, 250, 250, 5)).toBeNull();
    expect(paceVerdict(0, 250, 250, 5)).toBeNull();
  });
});

describe('amountVerdict', () => {
  it('grades distance with the fractional tolerance adherence uses', () => {
    expect(amountVerdict(10300, 10000, 10000, 0.15)).toEqual({ kind: 'on', delta: 0 });
    expect(amountVerdict(6200, 10000, 10000, 0.15)).toEqual({ kind: 'less', delta: 3800 });
    expect(amountVerdict(12000, 10000, 10000, 0.15)).toEqual({ kind: 'more', delta: 2000 });
  });

  it('has nothing to say about a plan with no amount', () => {
    expect(amountVerdict(5000, 0, 0, 0.15)).toBeNull();
    expect(amountVerdict(null, 10000, 10000, 0.15)).toBeNull();
  });

  it('draws less as the slow look and more as the fast look', () => {
    expect(amountLook('less')).toBe('slow');
    expect(amountLook('more')).toBe('fast');
    expect(amountLook('on')).toBe('on');
  });
});

describe('the words on the pills', () => {
  it('pace', () => {
    expect(pacePillText({ kind: 'on', deltaSec: 0 })).toBe('בתוכנית');
    expect(pacePillText({ kind: 'fast', deltaSec: 7 })).toBe('7 שנ׳ מהר');
    expect(pacePillText({ kind: 'slow', deltaSec: 9 })).toBe('9 שנ׳ לאט');
    expect(pacePillText({ kind: 'slow', deltaSec: 9 }, true)).toBe('9 שנ׳');
  });

  it('distance and time', () => {
    expect(distancePillText({ kind: 'less', delta: 3800 })).toBe('3.8 ק״מ חסר');
    expect(distancePillText({ kind: 'more', delta: 400 })).toBe('0.4 ק״מ יותר');
    expect(distancePillText({ kind: 'on', delta: 0 })).toBe('בתוכנית');
    expect(timePillText({ kind: 'less', delta: 1197 })).toBe('20 דק׳ חסר');
    expect(timePillText({ kind: 'more', delta: 20 })).toBe('1 דק׳ יותר');
  });
});

describe('formatting', () => {
  it('rounds a pace as a whole, never printing "3:60"', () => {
    expect(fmtPace(239.6)).toBe('4:00');
    expect(fmtPace(248)).toBe('4:08');
    expect(fmtPace(null)).toBe('—');
  });

  it('clocks and kilometres', () => {
    expect(fmtClock(3260)).toBe('54:20');
    expect(fmtClock(3903)).toBe('1:05:03');
    expect(fmtKm(10300)).toBe('10.3');
    expect(fmtKm(10000)).toBe('10');
  });
});
