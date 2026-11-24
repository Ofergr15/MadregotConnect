// Night queue #81: the circle's club messages say who posted them — only for a visible member, never the email.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/athletes/test-accounts', () => ({ testAccountIds: async () => new Set(['t1']) }));
const { storyAuthors } = await import('@/lib/feed/club-stories');

const athletes = [
  { id: 'a1', email: 'coach@x.test', name: 'Michal', avatar_url: 'https://x/m.jpg', status: 'active', approved: true },
  { id: 'p1', email: 'pending@x.test', name: 'Pending', avatar_url: null, status: 'invited', approved: false },
  { id: 't1', email: 'qa@x.test', name: 'QA', avatar_url: null, status: 'active', approved: true },
  { id: 'r1', email: 'gone@x.test', name: 'Gone', avatar_url: null, status: 'removed', approved: true },
];
const db = { from: () => { const q: any = { select: () => q, in: async (_c: string, v: string[]) => ({ data: athletes.filter((a) => v.includes(a.email)), error: null }) }; return q; } };

describe('storyAuthors', () => {
  it('resolves an active member; pending, test, removed and unknown get nothing', async () => {
    const m = await storyAuthors(db, ['Coach@X.test ', 'pending@x.test', 'qa@x.test', 'gone@x.test', 'nobody@x.test', null]);
    expect([...m.keys()]).toEqual(['coach@x.test']);
    expect(m.get('coach@x.test')).toEqual({ name: 'Michal', avatarUrl: 'https://x/m.jpg' });
  });
  it('no emails → no query, empty map', async () => {
    expect((await storyAuthors({ from: () => { throw new Error('no query expected'); } }, [null, undefined])).size).toBe(0);
  });
  it('a failed read leaves the circle without authors (never throws)', async () => {
    const bad = { from: () => { const q: any = { select: () => q, in: async () => ({ data: null, error: { message: 'x' } }) }; return q; } };
    expect((await storyAuthors(bad, ['coach@x.test'])).size).toBe(0);
  });
});
