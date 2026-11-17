import { describe, it, expect } from 'vitest';
import he from '../../messages/he.json';
import en from '../../messages/en.json';
import { pickLocalized, METRIC_KEYS } from '@/lib/badges/localize';

describe('badge localization', () => {
  it('picks the reader locale and falls back to the other language', () => {
    expect(pickLocalized('ריצה ראשונה 10 ק"מ', 'First 10K', 'he')).toBe('ריצה ראשונה 10 ק"מ');
    expect(pickLocalized('ריצה ראשונה 10 ק"מ', 'First 10K', 'en')).toBe('First 10K');
    expect(pickLocalized('', 'First 10K', 'he')).toBe('First 10K');
    expect(pickLocalized(null, null, 'he')).toBe('');
  });
  it('every metric template has non-empty he and en text with a {value} slot', () => {
    for (const ns of ['badgeManager', 'challengeManager'] as const) {
      for (const key of Object.values(METRIC_KEYS)) {
        for (const m of [he, en] as unknown as Record<string, Record<string, string>>[]) {
          const s = m[ns][key];
          expect(s?.trim()).toBeTruthy();
          expect(s).toContain('{value}');
        }
        expect((he as unknown as Record<string, Record<string, string>>)[ns][key]).toMatch(/[֐-׿]/);
      }
    }
  });
});
