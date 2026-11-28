// Task 183: photo gallery albums — per plan week / per event, keyset-paged album list, offset-paged
// album photos, signed thumbnails, member-only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  eventAlbums, pageAlbums, pageOffset, parseAlbumKey, weekAlbums, type AlbumFolder,
} from '@/lib/photos/albums';

const requireMember = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<object>()), requireMember: (r: Request) => requireMember(r) }));

const f = (id: string, date: string, count = 2): AlbumFolder => ({ id, date, title: null, name: id, count, covers: [`${id}-c1`, `${id}-c2`] });
// 2026-11-22 and 2026-11-29 are Sundays.
let folders: AlbumFolder[] | null = [f('a', '2026-11-22'), f('b', '2026-11-25'), f('c', '2026-11-29'), f('d', '2026-11-08')];
let events = [{ id: 'e1', name: 'Camp', date: '2026-11-24', end_date: '2026-11-26' }, { id: 'e2', name: 'Race', date: '2026-11-29', end_date: null }];
const folderPhotos: Record<string, Array<{ id: string; w: number; h: number; at: string | null }>> = {
  a: [{ id: 'a2', w: 1, h: 1, at: '2026:11:22 08:10:00' }, { id: 'a1', w: 1, h: 1, at: '2026:11:22 08:00:00' }],
  b: [{ id: 'b1', w: 1, h: 1, at: null }, { id: 'b0', w: 1, h: 1, at: '2026:11:25 07:00:00' }],
};
vi.mock('@/lib/photos/drive-browse', () => ({
  THUMB: 480, FULL: 1600,
  listPhotoFolders: async () => folders,
  listFolderPhotos: async (id: string) => ({ folder: { id }, photos: folderPhotos[id] ?? [], videos: [] }),
  signedImageUrl: (id: string, size: number) => `https://sig/${id}/${size}?exp=1`,
}));
vi.mock('@/lib/photos/mirror', () => ({
  mirroredUrls: async (ids: string[]) => ({ thumb: Object.fromEntries(ids.filter((i) => i.startsWith('a')).map((i) => [i, `https://cdn/${i}?token=x`])), full: {}, lqip: {} }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => {
    const q = {
      select: () => q, lte: () => q, or: () => q, order: () => q,
      limit: async () => ({ data: events, error: null }),
      eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: events.find((e) => e.id === id) ?? null, error: null }) }),
    };
    return { from: () => q };
  },
}));

const list = await import('@/app/api/photos/albums/route');
const one = await import('@/app/api/photos/albums/photos/route');
const getList = (q = '') => list.GET(new Request(`http://x/api/photos/albums?${q}`));
const getOne = (q: string) => one.GET(new Request(`http://x/api/photos/albums/photos?${q}`));

beforeEach(() => {
  requireMember.mockResolvedValue(null);
  folders = [f('a', '2026-11-22'), f('b', '2026-11-25'), f('c', '2026-11-29'), f('d', '2026-11-08')];
  events = [{ id: 'e1', name: 'Camp', date: '2026-11-24', end_date: '2026-11-26' }, { id: 'e2', name: 'Race', date: '2026-11-29', end_date: null }];
});

describe('album grouping', () => {
  it('one album per plan week (Sunday), newest first, counts and covers summed', () => {
    const w = weekAlbums([...folders!, { ...f('x', 'bad') }]);
    expect(w.map((a) => a.key)).toEqual(['week:2026-11-29', 'week:2026-11-22', 'week:2026-11-08']);
    expect(w[1]).toMatchObject({ from: '2026-11-22', to: '2026-11-25', count: 4, folderIds: ['b', 'a'], coverIds: ['b-c1', 'b-c2', 'a-c1'] });
  });
  it('events take the folders inside their dates; an event with no photos has no album', () => {
    const e = eventAlbums(folders!, [...events, { id: 'e3', name: 'Empty', date: '2026-01-01', end_date: null }]);
    expect(e.map((a) => [a.key, a.folderIds])).toEqual([['event:e2', ['c']], ['event:e1', ['b']]]);
    expect(e[1]).toMatchObject({ title: 'Camp', eventId: 'e1' });
  });
  it('keyset paging; an unknown cursor restarts at the top', () => {
    const w = weekAlbums(folders!);
    expect(pageAlbums(w, null, 2)).toMatchObject({ nextCursor: 'week:2026-11-22' });
    expect(pageAlbums(w, 'week:2026-11-22', 2)).toMatchObject({ albums: [{ key: 'week:2026-11-08' }], nextCursor: null });
    expect(pageAlbums(w, 'week:1999-01-03', 1).albums[0].key).toBe('week:2026-11-29');
  });
  it('album keys: a week key must be a Sunday; junk is null', () => {
    expect(parseAlbumKey('week:2026-11-22')).toEqual({ kind: 'week', value: '2026-11-22' });
    expect(parseAlbumKey('week:2026-11-23')).toBeNull();
    expect(parseAlbumKey('event:e1')).toEqual({ kind: 'event', value: 'e1' });
    expect(parseAlbumKey('folder:x')).toBeNull();
    expect(parseAlbumKey("event:1' or 1=1")).toBeNull();
  });
  it('offset paging', () => {
    expect(pageOffset([1, 2, 3, 4, 5], '2', 2)).toEqual({ items: [3, 4], nextOffset: 4 });
    expect(pageOffset([1, 2, 3], '-1', 5)).toEqual({ items: [1, 2, 3], nextOffset: null });
  });
});

describe('GET /api/photos/albums', () => {
  it('week albums, paged, covers signed (mirror first, signed Drive link else), private cache', async () => {
    const res = await getList('limit=2');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.albums.map((a: { key: string }) => a.key)).toEqual(['week:2026-11-29', 'week:2026-11-22']);
    expect(body.nextCursor).toBe('week:2026-11-22');
    expect(body.albums[1].covers).toEqual(['https://sig/b-c1/480?exp=1', 'https://sig/b-c2/480?exp=1', 'https://cdn/a-c1?token=x']);
    expect(body.albums[0].coverIds).toBeUndefined();
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
  it('event albums', async () => {
    const body = await (await getList('by=event')).json();
    expect(body.albums.map((a: { key: string }) => a.key)).toEqual(['event:e2', 'event:e1']);
  });
  it('not a member → the gate answers; bad by → 400; Drive unset → configured false', async () => {
    requireMember.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await getList()).status).toBe(401);
    requireMember.mockResolvedValue(null);
    expect((await getList('by=year')).status).toBe(400);
    folders = null;
    expect(await (await getList()).json()).toMatchObject({ configured: false, albums: [] });
  });
});

describe('GET /api/photos/albums/photos', () => {
  it("a week album's photos across its folders, in shot order, paged, signed", async () => {
    const body = await (await getOne('key=week:2026-11-22&limit=3')).json();
    expect(body.album).toMatchObject({ key: 'week:2026-11-22', count: 4 });
    expect(body.album.folderIds).toBeUndefined();
    expect(body.photos.map((p: { id: string }) => p.id)).toEqual(['a1', 'a2', 'b0']);
    expect(body.photos[0]).toMatchObject({ folderId: 'a', thumb: 'https://cdn/a1?token=x', full: 'https://sig/a1/1600?exp=1' });
    expect(body.nextOffset).toBe(3);
    const rest = await (await getOne('key=week:2026-11-22&limit=3&offset=3')).json();
    expect(rest.photos.map((p: { id: string }) => p.id)).toEqual(['b1']);
    expect(rest.nextOffset).toBeNull();
  });
  it('event album; unknown album 404; bad key 400; gate', async () => {
    expect((await (await getOne('key=event:e1')).json()).photos.map((p: { id: string }) => p.id)).toEqual(['b0', 'b1']);
    expect((await getOne('key=event:nope')).status).toBe(404);
    expect((await getOne('key=week:2026-01-04')).status).toBe(404);
    expect((await getOne('key=../x')).status).toBe(400);
    requireMember.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await getOne('key=event:e1')).status).toBe(403);
  });
});
