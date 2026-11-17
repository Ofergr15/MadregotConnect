import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { PRACTICE_SEED_COPY, localizePractice, localizeDuration } from '@/lib/practice/seed-i18n';

const HEB = /[֐-׿]/;

describe('practice seed i18n', () => {
  it('every seed entry has non-empty he and en text, Hebrew in he', () => {
    for (const [key, c] of Object.entries(PRACTICE_SEED_COPY)) {
      expect(c.en.title).toBe(key);
      for (const l of [c.en, c.he]) { expect(l.title.trim()).not.toBe(''); expect(l.description.trim()).not.toBe(''); }
      expect(c.he.title).toMatch(HEB);
      expect(c.he.description).toMatch(HEB);
    }
  });
  it('covers every seed title in the API default and the page seed', () => {
    for (const f of ['src/app/api/practice-videos/route.ts', 'src/app/(app)/dashboard/practice/page.tsx']) {
      const src = readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
      const titles = [...src.matchAll(/title: '([^']+)', description/g)].map((m) => m[1]);
      expect(titles.length).toBe(6);
      for (const t of titles) expect(PRACTICE_SEED_COPY[t]).toBeDefined();
    }
  });
  it('localizes by locale and passes coach-typed text through', () => {
    const v = { title: 'Leg Workout', description: 'Leg strengthening exercises for runners.' };
    expect(localizePractice(v, 'he').title).toBe('אימון רגליים');
    expect(localizePractice(v, 'en')).toEqual(v);
    const custom = { title: 'My drill', description: 'x' };
    expect(localizePractice(custom, 'he')).toEqual(custom);
    const edited = { title: 'Leg Workout', description: 'coach note' };
    expect(localizePractice(edited, 'he').description).toBe('coach note');
    expect(localizeDuration('8 min', 'he')).toBe('8 דק׳');
    expect(localizeDuration('8 min', 'en')).toBe('8 min');
  });
});
