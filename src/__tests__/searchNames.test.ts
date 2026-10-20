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
