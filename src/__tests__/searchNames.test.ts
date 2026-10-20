import { describe, expect, it } from 'vitest';
import fs from 'fs';
import { nameMatches, personMatches } from '@/lib/search/match';

// Search, 2026-10-20 (mockup ~/.cache/madregot/search-proposal.html): a name typed in either
// script finds the member, the short ones included, and every screen's own filter agrees.
describe('a name in either script', () => {
  it.each([
    ['Alon Lifshitz', 'אלון'], ['נתנאל וינר', 'Netanel'], ['Ido Bar-On', 'עידו'],
    ['Chen Becher', 'חן'], ['Itai Spiegel', 'איתי'], ['Yosi Sabag', 'יוסי'], ['Alon Lifshitz', 'אלון ליפשיץ'],
  ])('%s ← "%s"', (name, q) => expect(nameMatches(name, q)).toBe(true));
  it.each([
    ['Itai Spiegel', 'אלון'], ['Tal Borenstein', 'איתי'], ['Amit Lazar', 'חן'], ['Alon Lifshitz', 'א'],
  ])('not %s ← "%s"', (name, q) => expect(nameMatches(name, q)).toBe(false));
  it('a screen filter also reads the email', () => {
    expect(personMatches('Ofer Grosfeld', 'grosfeldofer@', 'grosfeldofer@gmail.com')).toBe(true);
    expect(personMatches('Ofer Grosfeld', '')).toBe(true);
  });
  it('all six screens filter through it', () => {
    for (const f of ['src/app/(app)/dashboard/athletes/page.tsx', 'src/app/(app)/dashboard/roles/page.tsx', 'src/app/(app)/dashboard/people/page.tsx',
      'src/app/(app)/dashboard/entry-queue/page.tsx', 'src/components/MemberDiscovery.tsx', 'src/app/(app)/dashboard/settings/page.tsx']) {
      expect(fs.readFileSync(f, 'utf8'), f).toMatch(/personMatches\(/);
    }
  });
});

describe('every search box in the app (2026-10-20: academy, photos, all of them)', () => {
  it('a workout typed with x finds it written with ×, and back', async () => {
    const { textMatches } = await import('@/lib/search/match');
    expect(textMatches('10x400', '10 × 400 מהיר')).toBe(true);
    expect(textMatches('10 × 400', '10X400')).toBe(true);
    expect(textMatches('6*1000', 'Intervals 6 x 1000')).toBe(true);
    expect(textMatches('400', '10 × 1600')).toBe(false);
    expect(textMatches('6 ×', '6 × 1 ק״מ')).toBe(true);
    expect(textMatches('6x', '6 × 1 ק״מ')).toBe(true);
  });
  it('no name filter is left on plain letters', () => {
    const { execSync } = require('child_process') as typeof import('child_process');
    const out = execSync(`grep -rnE "\\.name( \\|\\| '')?\\)?\\.toLowerCase\\(\\)\\.includes\\(" src/app src/components src/lib --include=*.tsx --include=*.ts || true`, { encoding: 'utf8' })
      .split('\n').filter((l) => l && !l.includes('__tests__') && !l.includes('page.disabled.tsx') && !l.includes('lib/search/match.ts'));
    expect(out).toEqual([]);
  });
});
