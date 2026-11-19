import { describe, expect, it } from 'vitest';
import {
  U21_TRACKS, ageBand, ageOn, fieldVisible, pickKnownAnswers, screenSafety, validateU21Intake,
  type U21Answers,
} from '@/lib/u21/intake';

const NOW = new Date('2026-11-19T12:00:00Z');

function adult(over: U21Answers = {}): U21Answers {
  return {
    firstName: 'דניאל', lastName: 'לוי', email: 'test@example.com', phone: '050-1234567',
    birthDate: '2006-05-01', framework: 'שנת שירות', goal: 'גיבוש', experience: 'פחות משנה',
    runsPerWeek: '1–2', strengthExperience: 'מעט', availableDays: ['ראשון', 'שלישי'],
    sleepHours: '7–8', chestPain: 'no', fainting: 'no', bonePain: 'no', acuteInjury: 'no',
    ...over,
  };
}

describe('U21 tracks', () => {
  it('has the three spec prices', () => {
    expect(U21_TRACKS.map(t => [t.id, t.priceIls])).toEqual([['basic', 79], ['advanced', 119], ['pro', 219]]);
  });
});

describe('ageOn / ageBand', () => {
  it('counts whole years around the birthday', () => {
    expect(ageOn('2008-11-19', NOW)).toBe(18);
    expect(ageOn('2008-11-20', NOW)).toBe(17);
    expect(ageOn('2008-02-30', NOW)).toBeNull();
    expect(ageOn('nope', NOW)).toBeNull();
  });
  it('bands', () => {
    expect(ageBand(15)).toBe('under16');
    expect(ageBand(17)).toBe('16-17');
    expect(ageBand(18)).toBe('18-21');
    expect(ageBand(22)).toBe('over21');
  });
});

describe('validateU21Intake', () => {
  it('accepts a complete adult intake', () => {
    const r = validateU21Intake('advanced', adult(), NOW);
    expect(r.errors).toEqual({});
    expect(r.ok).toBe(true);
    expect(r.age).toBe(20);
  });
  it('requires a known track', () => {
    expect(validateU21Intake('gold', adult(), NOW).errors.track).toBeDefined();
  });
  it('rejects ages outside 16-21', () => {
    expect(validateU21Intake('basic', adult({ birthDate: '2011-01-01' }), NOW).errors.birthDate).toBeDefined();
    expect(validateU21Intake('basic', adult({ birthDate: '2000-01-01' }), NOW).errors.birthDate).toBeDefined();
  });
  it('requires guardian name, phone and consent under 18', () => {
    const minor = adult({ birthDate: '2009-06-01' });
    const r = validateU21Intake('basic', minor, NOW);
    expect(Object.keys(r.errors).sort()).toEqual(['guardianConsent', 'guardianName', 'guardianPhone']);
    const ok = validateU21Intake('basic', { ...minor, guardianName: 'אמא', guardianPhone: '0521234567', guardianConsent: true }, NOW);
    expect(ok.ok).toBe(true);
  });
  it('does not ask an adult for a guardian', () => {
    expect(fieldVisible('guardianName', {}, 19)).toBe(false);
    expect(fieldVisible('guardianName', {}, 16)).toBe(true);
  });
  it('rejects bad email, phone, options and missing safety answers', () => {
    const r = validateU21Intake('pro', adult({ email: 'x', phone: '123', runsPerWeek: '9', chestPain: undefined }), NOW);
    expect(r.errors).toMatchObject({ email: expect.any(String), phone: expect.any(String), runsPerWeek: expect.any(String), chestPain: expect.any(String) });
  });
});

describe('screenSafety (draft list)', () => {
  it('no flags when all answers are no', () => {
    expect(screenSafety(adult()).flagged).toBe(false);
  });
  it('any yes flags, naming which', () => {
    const r = screenSafety(adult({ bonePain: 'yes' }));
    expect(r.flagged).toBe(true);
    expect(r.flags.bone_pain).toBe(true);
    expect(r.flags.chest_pain).toBe(false);
  });
});

describe('pickKnownAnswers', () => {
  it('drops unknown keys and hidden guardian fields for adults', () => {
    const out = pickKnownAnswers({ ...adult(), evil: 'x', guardianName: 'y' }, 20);
    expect(out.evil).toBeUndefined();
    expect(out.guardianName).toBeUndefined();
    expect(out.firstName).toBe('דניאל');
  });
});
