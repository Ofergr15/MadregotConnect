import { describe, expect, it } from 'vitest';
import { cleanIntake } from '@/lib/join/intake';

/** What the unified sign-up stores with a club request (migration 158). */
describe('cleanIntake', () => {
  it('keeps the best time, how they came and the academy interest', () => {
    expect(cleanIntake({ bestDistance: 'marathon', bestSeconds: 9680, race: 'מרתון תל אביב', year: 2026, heardFrom: 'club-member', heardWho: 'שי', academyInterest: true }))
      .toEqual({ bestDistance: 'marathon', bestSeconds: 9680, race: 'מרתון תל אביב', year: 2026, noRace: false, heardFrom: 'club-member', heardWho: 'שי', academyInterest: true });
  });
  it('drops what it did not ask for, and a time with no distance', () => {
    const c = cleanIntake({ bestDistance: 'ultra', bestSeconds: 9680, heardFrom: 'tiktok', year: 1850, academyInterest: 'yes', extra: 1 });
    expect(c).toMatchObject({ bestDistance: null, bestSeconds: null, heardFrom: null, year: null, academyInterest: false });
    expect(c).not.toHaveProperty('extra');
    expect(cleanIntake(null)).toBeNull();
  });
  it('no race yet is kept', () => expect(cleanIntake({ noRace: true })?.noRace).toBe(true));
});

describe('the approval queue reads the sign-up', () => {
  it('best time with the race, how they came and who, the academy', async () => {
    const { intakeLines } = await import('@/lib/join/intake');
    expect(intakeLines({ bestDistance: 'marathon', bestSeconds: 3 * 3600 + 5 * 60, race: 'ולנסיה', year: 2025, heardFrom: 'club-member', heardWho: 'דני', academyInterest: true }))
      .toEqual(['מרתון 3:05:00 · ולנסיה 2025', 'הגיע/ה דרך: חבר/ה במועדון — דני', 'מתעניין/ת גם באקדמיה']);
    expect(intakeLines({ noRace: true, heardFrom: 'instagram' })).toEqual(['עוד לא רץ/ה מרוץ', 'הגיע/ה דרך: אינסטגרם']);
    expect(intakeLines(null)).toEqual([]);
  });
});
