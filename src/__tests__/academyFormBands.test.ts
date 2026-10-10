import { describe, expect, it } from 'vitest';
import { FORM_BANDS, formBand, formSentenceKey, isHeavyWeek, rampWord, signed } from '@/lib/academy/form-bands';

/** Form and ramp → one word (spec §3.3/§3.4), at every edge. */

describe('formBand', () => {
  it('cuts at −30 / −29…−11 / −10…4 / 5…29 / ≥30', () => {
    const cases: Array<[number, string]> = [
      [-45, 'veryTired'], [-30, 'veryTired'], [-29, 'working'], [-11, 'working'], [-10, 'maintain'],
      [4, 'maintain'], [5, 'fresh'], [29, 'fresh'], [30, 'detraining'], [31, 'detraining'],
    ];
    for (const [form, key] of cases) expect([form, formBand(form).key]).toEqual([form, key]);
  });

  it('judges the integer the screen prints', () => {
    expect(formBand(-10.4).key).toBe('maintain');
    expect(formBand(-10.6).key).toBe('working');
    expect(formBand(4.4).key).toBe('maintain');
  });

  it('five bands, most tired first, with the mockup colours and keys only', () => {
    expect(FORM_BANDS.map(b => b.key)).toEqual(['veryTired', 'working', 'maintain', 'fresh', 'detraining']);
    expect(FORM_BANDS.map(b => b.color)).toEqual(['#E5484D', '#1FA55B', '#9AD5B0', '#5B9BF0', '#C9CBD6']);
    expect(FORM_BANDS[2].wordKey).toBe('trainee.bands.maintain.word');
  });
});

describe('rampWord', () => {
  it('≥9 too fast / 5…8 building / 0…4 maintaining / ≤−1 recovering', () => {
    expect(rampWord(9)).toEqual({ key: 'tooFast', wordKey: 'trainee.ramp.tooFast', warn: true });
    expect(rampWord(8).key).toBe('building');
    expect(rampWord(5).key).toBe('building');
    expect(rampWord(4).key).toBe('maintaining');
    expect(rampWord(0).key).toBe('maintaining');
    expect(rampWord(-1).key).toBe('recovering');
    expect(rampWord(8).warn).toBe(false);
  });

  it('a planned easy week says so instead of "recovering"', () => {
    expect(rampWord(-3, { easyWeek: true }).key).toBe('easyWeek');
    expect(rampWord(2, { easyWeek: true }).key).toBe('maintaining');
  });
});

describe('formSentenceKey', () => {
  it('is per band and day, with the heavy-week variant only where it changes the advice', () => {
    expect(formSentenceKey({ band: 'maintain', heavyLastWeek: true, day: 'quality' })).toBe('trainee.formSentence.maintain_quality_heavy');
    expect(formSentenceKey({ band: 'maintain', heavyLastWeek: true, day: 'rest' })).toBe('trainee.formSentence.maintain_rest');
    expect(formSentenceKey({ band: 'veryTired', heavyLastWeek: true, day: 'quality' })).toBe('trainee.formSentence.veryTired_quality');
    expect(formSentenceKey({ band: 'fresh', heavyLastWeek: false, day: 'easy' })).toBe('trainee.formSentence.fresh_easy');
  });

  it('a heavy week is > 1.15 × the 4-week mean', () => {
    expect(isHeavyWeek(435, [349, 232, 362, 405])).toBe(true);
    expect(isHeavyWeek(360, [349, 332, 362, 345])).toBe(false);
  });
});

describe('signed', () => {
  it('uses a real minus sign', () => {
    expect(signed(-9)).toBe('−9');
    expect(signed(11)).toBe('+11');
    expect(signed(0)).toBe('0');
    expect(signed(-0.4)).toBe('0');
  });
});
