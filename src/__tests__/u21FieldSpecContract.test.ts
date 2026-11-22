import { describe, expect, it } from 'vitest';
import { U21_FIELDS, U21_MAX_AGE, U21_MIN_AGE, fieldVisible, isU21Track, validateU21Intake } from '@/lib/u21/intake';

/**
 * CONTRACT: the U21 questionnaire as the server enforces it. The native app mirrors this list
 * (docs/contracts/u21-fields.md). Any change here — a key, a type, required-ness or one option's
 * exact characters — breaks a native submit with a 400, so this test fails first.
 */

// [key, type, required, options] in display order. Options are byte-exact (en dash, maqaf).
const SPEC = [["firstName","text",true,null],["lastName","text",true,null],["email","email",true,null],["phone","tel",true,null],["birthDate","date",true,null],["guardianName","text",true,null],["guardianPhone","tel",true,null],["guardianConsent","checkbox",true,null],["framework","radio",true,["מכינה קדם־צבאית","שנת שירות","תיכון","אחר"]],["frameworkOther","text",false,null],["goal","textarea",true,null],["targetDate","date",false,null],["experience","radio",true,["אין ניסיון","פחות משנה","1–3 שנים","יותר מ־3 שנים"]],["fitnessResults","textarea",false,null],["runsPerWeek","radio",true,["0","1–2","3–4","5+"]],["weeklyKm","number",false,null],["strengthExperience","radio",true,["אין","מעט","מתאמן/ת באופן קבוע"]],["otherTraining","textarea",false,null],["availableDays","checkboxes",true,["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"]],["equipment","checkboxes",false,["ללא ציוד","מתח","משקולות","חדר כושר","גומיות","מסלול / מגרש"]],["sleepHours","radio",true,["פחות מ־6","6–7","7–8","יותר מ־8"]],["recovery","radio",false,["טוב","בינוני","עייף/ה רוב הזמן"]],["chestPain","yesno",true,null],["fainting","yesno",true,null],["bonePain","yesno",true,null],["acuteInjury","yesno",true,null],["injuries","textarea",false,null],["preferences","textarea",false,null]];

describe('U21 field spec', () => {
  it('keys, types, required and options are exactly the pinned list', () => {
    expect(U21_FIELDS.map((f: any) => [f.key, f.type, !!f.required, f.options ?? null])).toEqual(SPEC);
  });
  it('options use the en dash (U+2013) and the maqaf (U+05BE), which a hyphen does not match', () => {
    const v = validateU21Intake('basic', { experience: '1-3 שנים' } as never);
    expect(v.errors.experience).toBeDefined();
    expect(SPEC.flatMap((s: any) => s[3] ?? []).some((o: string) => o.includes('–'))).toBe(true);
    expect(SPEC.flatMap((s: any) => s[3] ?? []).some((o: string) => o.includes('־'))).toBe(true);
  });
  it('tracks are exactly basic / advanced / pro; ages 16–21', () => {
    expect(['basic', 'advanced', 'pro'].every(isU21Track)).toBe(true);
    expect(isU21Track('BASIC')).toBe(false);
    expect([U21_MIN_AGE, U21_MAX_AGE]).toEqual([16, 21]);
  });
  it('conditional fields: guardian* only under 18; frameworkOther only when framework is "אחר"', () => {
    for (const k of ['guardianName', 'guardianPhone', 'guardianConsent']) {
      expect(fieldVisible(k, {}, 17)).toBe(true);
      expect(fieldVisible(k, {}, 18)).toBe(false);
      expect(fieldVisible(k, {}, null)).toBe(false);
    }
    expect(fieldVisible('frameworkOther', { framework: 'אחר' }, 19)).toBe(true);
    expect(fieldVisible('frameworkOther', { framework: 'תיכון' }, 19)).toBe(false);
  });
});
