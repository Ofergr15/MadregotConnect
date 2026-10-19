import { describe, expect, it } from 'vitest';
import { nameMatches } from '@/lib/search/match';

/** Search: a member found by name typed in either script (10-19: "אלון" found nobody). */
describe('nameMatches', () => {
  it('Hebrew typing finds the Latin roster name', () => {
    expect(nameMatches('Alon Lifshitz', 'אלון')).toBe(true);
    expect(nameMatches('Alon Lifshitz', 'ליפשיץ')).toBe(true);
    expect(nameMatches('Eldar Pardo', 'פרדו')).toBe(true);
    expect(nameMatches('Shalev Bahalul', 'שליו')).toBe(true);
    expect(nameMatches('Guy Joselson', 'אלון')).toBe(false);
  });
  it('Latin typing still works by letters, and finds a Hebrew name too', () => {
    expect(nameMatches('Alon Lifshitz', 'lif')).toBe(true);
    expect(nameMatches('נתנאל וינר', 'נתנ')).toBe(true);
    expect(nameMatches('נתנאל וינר', 'netanel')).toBe(true);
  });
  it('too little to go on matches nothing', () => {
    expect(nameMatches('Alon Lifshitz', 'א')).toBe(false);
    expect(nameMatches('Alon Lifshitz', 'אי')).toBe(false);
  });
});

describe('the shared fold (lib/auth/athlete-identity)', () => {
  it('"tz" in Latin and צ in Hebrew are one sound', async () => {
    const { athleteNameKeys } = await import('@/lib/auth/athlete-identity');
    const he = new Set(athleteNameKeys('אלון ליפשיץ'));
    expect(athleteNameKeys('Alon Lifshitz').some((k) => he.has(k))).toBe(true);
  });
});
