import { describe, expect, it } from 'vitest';
import { memberGroupName, memberPackName, profilePackChip } from '@/lib/utils';

/** The pack chip on a profile: Hebrew, and never two "דבוקה" chips that disagree. */
describe('profile pack chip', () => {
  it('names the club groups as packs 1–3, in Hebrew', () => {
    expect(memberPackName('Group A - SUB 2:30')).toBe('דבוקה 1');
    expect(memberPackName('Group 2')).toBe('דבוקה 2'); // what the profile API sends today
    expect(memberPackName('Group C - SUB 2:45')).toBe('דבוקה 3');
    expect(memberPackName('Something else')).toBe('Something else');
  });

  it('shows the academy band instead of the club pack for a trainee', () => {
    expect(profilePackChip('Group 1', 'דבוקה 6')).toBeNull();
    expect(profilePackChip('Group 1', null)).toBe('דבוקה 1');
    expect(profilePackChip(null, null)).toBeNull();
  });

  it('leaves the mails and join screens on "קבוצה"', () => {
    expect(memberGroupName('Group 2')).toBe('קבוצה 2');
  });
});
