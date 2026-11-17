import { describe, it, expect } from 'vitest';
import { dayWord, shortDate, weekSections, type LiveLike } from '@/lib/stories/area';

const today = '2026-11-17';
const survey = (until: unknown): LiveLike => ({ id: 's1', source: 'survey', emoji: '📊', title: 'מי בא לרוץ מחר?', until: until as string, active: true, answers: 4 });

describe('hub on-air row dates (QA 11-17: "נסגר undefined")', () => {
  it('dayWord says nothing for missing or malformed days', () => {
    for (const bad of [null, undefined, '', 'Invalid Date', 'nope', '2026-13-45']) expect(dayWord(bad as never, today)).toBe('');
    expect(dayWord('2026-11-17', today)).toBe('היום');
    expect(dayWord('2026-11-18', today)).toBe('מחר');
    expect(dayWord('2026-11-20T00:00:00Z', today)).toBe('ו׳');
  });
  it('a survey with no valid closing date reads "פתוח", never undefined/NaN', () => {
    for (const bad of [null, undefined, '', 'Invalid Date']) {
      const sub = weekSections([survey(bad)], [], [], today).air[0].sub;
      expect(sub).toBe('4 ענו · פתוח');
      expect(sub).not.toMatch(/undefined|NaN|Invalid/);
    }
    expect(weekSections([survey('2026-11-18')], [], [], today).air[0].sub).toBe('4 ענו · נסגר מחר');
  });
  it('shortDate is empty for bad input', () => {
    expect(shortDate(undefined)).toBe('');
    expect(shortDate('2026-10-23')).toBe('ו׳ 23.10');
  });
});
