import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/search (mockup search-mockup.html, 2026-10-19): a name typed in Hebrew finds the
 * Latin roster name, photo albums are searched, the hidden store's products are not, and
 * `?start=1` gives the screen before typing — the pack, the next races, the newest albums.
 */

const ME = 'me-id';
const ROSTER = [
  { id: 'a1', name: 'Alon Lifshitz', avatar_url: null, group_id: 'g2' },
  { id: 'a2', name: 'Guy Joselson', avatar_url: null, group_id: 'g2' },
  { id: ME, name: 'Ofer Grosfeld', avatar_url: null, group_id: 'g2' },
  { id: 'a3', name: 'Tal Levi', avatar_url: null, group_id: 'g1' },
];
const asked: string[] = [];

function from(table: string) {
  asked.push(table);
  const f: Record<string, unknown> = {};
  const rows = () => {
    if (table === 'athletes') {
      let r = ROSTER;
      if (f.id) r = r.filter((a) => a.id === f.id);
      if (f.group_id) r = r.filter((a) => a.group_id === f.group_id && a.id !== f.neq);
      return r;
    }
    if (table === 'groups') return [{ name: 'Group B' }];
    if (table === 'events') return [{ id: 'e1', name: 'חצי מרתון עמק החולה', kind: 'race', date: '2099-10-30', location: 'x' }];
    return [];
  };
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'ilike', 'or', 'order', 'limit', 'gte', 'in']) b[m] = () => b;
  b.eq = (k: string, v: unknown) => { f[k] = v; return b; };
  b.neq = (_k: string, v: unknown) => { f.neq = v; return b; };
  b.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(ok);
  return b;
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from }) }));
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: ME, isStaff: false, isSuperUser: false } }) }));
vi.mock('@/lib/photos/drive-browse', () => ({
  THUMB: 480,
  signedImageUrl: (id: string) => `/img/${id}`,
  listPhotoFolders: async () => [
    { id: 'p0', name: 'מרוץ הסרגל 2026', title: 'מרוץ הסרגל 2026', date: '2026-10-09', count: 14, covers: ['c0'], pinned: true },
    { id: 'p1', name: 'יום שישי 16.10', title: 'שישי 16.10', date: '2026-10-16', count: 19, covers: ['c1'], pinned: false },
  ],
}));
vi.mock('@/lib/photos/mirror', () => ({ mirroredUrls: async () => ({ thumb: {}, full: {}, lqip: {} }) }));

const { GET } = await import('@/app/api/search/route');
const get = async (qs: string) => (await GET(new Request(`http://x/api/search?${qs}`))).json();

beforeEach(() => { asked.length = 0; });

describe('typing', () => {
  it('"אלון" finds Alon Lifshitz, and nobody else', async () => {
    const r = await get(`q=${encodeURIComponent('אלון')}`);
    expect(r.members.map((m: { name: string }) => m.name)).toEqual(['Alon Lifshitz']);
  });
  it('an album is found by its title', async () => {
    const r = await get(`q=${encodeURIComponent('סרגל')}`);
    expect(r.albums).toEqual([{ id: 'p0', title: 'מרוץ הסרגל 2026', date: '2026-10-09', count: 14, cover: '/img/c0' }]);
  });
  it('the hidden store is not asked for products', async () => {
    await get('q=shirt');
    expect(asked).not.toContain('store_products');
  });
});

describe('before typing (?start=1)', () => {
  it('my pack without me, the next race, the newest unpinned albums', async () => {
    const r = await get('start=1');
    expect(r.pack.map((m: { id: string }) => m.id)).toEqual(['a1', 'a2']);
    expect(r.packName).toBe('Group B');
    expect(r.races).toHaveLength(1);
    expect(r.albums.map((a: { id: string }) => a.id)).toEqual(['p1']);
  });
});
