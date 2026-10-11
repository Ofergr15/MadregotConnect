import { describe, expect, it } from 'vitest';
import { hrEstimateKey } from '@/lib/academy/test-state';
import he from '../../messages/he.json';

/**
 * Round-2 copy that is decided purely: the "הערכה לפי דופק" line agrees with the test line
 * above it, and the sentences the fixes rely on exist in Hebrew.
 */
describe('hrEstimateKey', () => {
  it('a pending or 2000 m test is not "עוד אין טסט"', () => {
    expect(hrEstimateKey('pending')).toBe('hrEstimatePending');
    expect(hrEstimateKey('otherProtocol')).toBe('hrEstimateOther');
    expect(hrEstimateKey('none')).toBe('hrEstimate');
    expect(hrEstimateKey(null)).toBe('hrEstimate');
    expect(hrEstimateKey('ok')).toBe('hrEstimateOk');
    const form = he.trainee.home.form;
    expect(form.hrEstimatePending).not.toMatch(/עוד אין טסט/);
    expect(form.hrEstimateOther).not.toMatch(/עוד אין טסט/);
    expect(form.hrEstimateOther).toMatch(/30/);
    const th = he.trainee.progress.threshold;
    for (const k of ['pending', 'pendingSub', 'other', 'otherSub'] as const) expect(th[k]).not.toMatch(/עוד אין טסט/);
  });

  it('the run WITH heart rate is not told to run with heart rate', () => {
    expect(he.trainee.done.noLoadHrLearning).not.toMatch(/ריצה עם דופק/);
    expect(he.trainee.done.noLoadHrLearning).toMatch(/הערכה לפי דופק/);
  });

  it('the held projection never says there is room to add load', () => {
    expect(he.readiness.detail.say.hold).not.toMatch(/יש מקום להוסיף/);
    expect(he.readiness.detail.say.holdTail).not.toMatch(/יש מקום להוסיף/);
  });

  it('the stopped-feed sentences name what is missing', () => {
    expect(he.readiness.detail.feelNoFeedSub).not.toMatch(/בלי כאב|0 מתוך/);
    expect(he.trainee.week.noFeedSay).toMatch(/לא מגיעות/);
  });
});
