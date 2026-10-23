import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Sheets sit at z-[300]/[310] and the update sheet at z-[400]/[405]. A screen's own layers must
 * never outrank them: the run page's map card (z-[900]/[1000] for Leaflet) was drawn on top of
 * עוד and of the new-version sheet (Ofer 2026-10-23). Map containers are `isolate`d, and fixed
 * page buttons stay just above the tab bar (z-40).
 */
const read = (p: string) => readFileSync(p, 'utf8');

describe('page layers stay under sheets', () => {
  it('the run page map card is isolated', () => {
    expect(read('src/app/(app)/dashboard/activities/[activityId]/page.tsx')).toMatch(/className="relative isolate overflow-hidden rounded-card"/);
  });
  it('the run-together map is isolated and its + button is under the sheets', () => {
    const src = read('src/app/(app)/dashboard/run-together/page.tsx');
    expect(src).toMatch(/relative isolate -mx-4/);
    expect(src).not.toMatch(/fixed z-\[600\]/);
  });
});
