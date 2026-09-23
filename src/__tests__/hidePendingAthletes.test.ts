import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { seesPending, withoutPendingAuthors } from '@/lib/auth/pending-athletes';

const src = (p: string) => readFileSync(p, 'utf8');

describe('withoutPendingAuthors (#77)', () => {
  const rows = [
    { id: '1', author_athlete_id: 'a' },
    { id: '2', author_athlete_id: 'pending' },
    { id: '3', author_athlete_id: null },
  ];

  it('drops a pending runner and keeps announcements with no author', () => {
    expect(withoutPendingAuthors(rows, new Set(['pending'])).map(r => r.id)).toEqual(['1', '3']);
  });

  it('with nobody pending the page is untouched', () => {
    expect(withoutPendingAuthors(rows, new Set())).toBe(rows);
  });
});

describe('seesPending', () => {
  it('the runner and staff see them, a teammate does not', () => {
    expect(seesPending({ athleteId: 'p' }, 'p')).toBe(true);
    expect(seesPending({ isStaff: true, athleteId: 'x' }, 'p')).toBe(true);
    expect(seesPending({ athleteId: 'x' }, 'p')).toBe(false);
    expect(seesPending({ athleteId: null }, 'p')).toBe(false);
  });
});

describe('every surface that showed a pending runner checks for one', () => {
  it('feed: filters after the slice, cursor from the raw page', () => {
    const s = src('src/app/api/feed/route.ts');
    expect(s).toMatch(/withoutPendingAuthors\(raw/);
    expect(s).toMatch(/const last = raw\[raw\.length - 1\]/);
  });

  it('single feed item, athlete stats and activity details 404 for a teammate', () => {
    for (const p of ['src/app/api/feed/items/[id]/route.ts', 'src/app/api/athletes/[id]/stats/route.ts', 'src/app/api/activities/details/route.ts']) {
      expect(src(p), p).toMatch(/!seesPending\([^)]*\) && \(await isPendingAthlete/);
    }
  });

  it('no "X ran" push, no group challenge credit, and awards stay quiet', () => {
    expect(src('src/lib/push.ts')).toMatch(/approved === false\) return 0/);
    expect(src('src/lib/challenges/engine.ts')).toMatch(/\.or\('approved\.is\.null,approved\.eq\.true'\)/);
    expect(src('src/lib/badges/award-engine.ts')).toMatch(/row\?\.approved === false \|\| joinedRecently/);
  });
});
