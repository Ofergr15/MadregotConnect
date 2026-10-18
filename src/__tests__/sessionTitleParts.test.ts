import { describe, expect, it } from 'vitest';
import { nameQualifier, sessionTitleParts } from '@/lib/plans/week-summary';

const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** The feed card read "50–70 דק׳ · 50 · 70 דק׳" for a one-day session (2026-10-18). */
describe('a session line', () => {
  it('keeps a number range and a clock whole', () => {
    expect(nameQualifier('50–70 דק׳', days)).toBe('50–70 דק׳');
    expect(nameQualifier('50 דק׳ 4:40-5:15', days)).toBe('50 דק׳ 4:40–5:15');
  });

  it('says the headline once', () => {
    expect(sessionTitleParts('50–70 דק׳', '50–70 דק׳', days)).toBe('50–70 דק׳');
    expect(sessionTitleParts('50 דק׳', '50 דק׳ 4:40-5:15', days)).toBe('50 דק׳ · 4:40–5:15');
  });

  it('still splits the coach\'s own parts and drops the day', () => {
    expect(sessionTitleParts('7 × 5 ק״מ', 'שישי - ארוכה מיוחדת', days)).toBe('7 × 5 ק״מ · ארוכה מיוחדת');
    expect(sessionTitleParts('17 × 500 מ׳', 'שלישי - בוקר', days)).toBe('17 × 500 מ׳');
  });
});
