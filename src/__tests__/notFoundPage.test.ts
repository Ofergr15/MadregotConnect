import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import he from '../../messages/he.json';
import en from '../../messages/en.json';

describe('root not-found page', () => {
  it('has every string in both locales', () => {
    expect(Object.keys(he.notFoundPage).sort()).toEqual(Object.keys(en.notFoundPage).sort());
    expect(he.notFoundPage.title).toBe('הדף לא נמצא');
  });

  it('offers a way back to the feed, drawn with the journey kit', () => {
    const src = readFileSync('src/app/not-found.tsx', 'utf8');
    expect(src).toContain('href="/feed"');
    expect(src).toContain("from '@/components/onboarding/journey-ui'");
  });
});
