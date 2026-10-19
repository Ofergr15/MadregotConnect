import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The club photos' own copy (lib/photos/mirror.ts): the listings ask it for links,
 * and anything it can't answer must fall back to Drive, never fail the screen.
 */
// The record as stored since the 10-19 rework: a small flags file, and the blurred
// previews in shards (any shard path answers with both, which is all these tests need).
const flags = { v: 2, t: ['AAAAAAAAAA1', 'AAAAAAAAAA2'], f: ['AAAAAAAAAA1'] };
const shard = { AAAAAAAAAA1: 'data:image/jpeg;base64,xx' };
let failSign = false;
const createSignedUrls = vi.fn(async (paths: string[]) => {
  if (failSign) throw new Error('storage down');
  return { data: paths.map((path) => ({ path, signedUrl: `https://cdn.test/${path}?token=t` })), error: null };
});
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    storage: {
      from: () => ({
        download: async (path: string) => ({ data: new Blob([JSON.stringify(path === 'flags.json' ? flags : shard)]), error: null }),
        createSignedUrls,
      }),
    },
  }),
}));
vi.mock('@/lib/photos/drive-browse', () => ({ FULL: 1600, THUMB: 480, fetchDriveThumbnail: vi.fn(), listAllPhotoIds: vi.fn(async () => []) }));

beforeEach(() => { failSign = false; createSignedUrls.mockClear(); });

describe('mirrored photo links', () => {
  it('signs the copied sizes and carries the blurred preview', async () => {
    const { mirroredUrls } = await import('@/lib/photos/mirror');
    const m = await mirroredUrls(['AAAAAAAAAA1', 'AAAAAAAAAA2']);
    expect(m.thumb.AAAAAAAAAA1).toBe('https://cdn.test/t/AAAAAAAAAA1.jpg?token=t');
    expect(m.full.AAAAAAAAAA1).toBe('https://cdn.test/f/AAAAAAAAAA1.jpg?token=t');
    expect(m.lqip.AAAAAAAAAA1).toMatch(/^data:image\/jpeg;base64,/);
    // Only the grid size of the second one is copied: its full size stays Drive's.
    expect(m.thumb.AAAAAAAAAA2).toBeDefined();
    expect(m.full.AAAAAAAAAA2).toBeUndefined();
  });

  it('answers nothing for a photo not copied yet, so the route keeps its Drive link', async () => {
    const { mirroredUrls } = await import('@/lib/photos/mirror');
    const m = await mirroredUrls(['BBBBBBBBBB9']);
    expect(m).toEqual({ thumb: {}, full: {}, lqip: {} });
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('falls back to Drive when storage fails, rather than failing the screen', async () => {
    failSign = true;
    const { mirroredUrls } = await import('@/lib/photos/mirror');
    await expect(mirroredUrls(['AAAAAAAAAA1'])).resolves.toEqual({ thumb: {}, full: {}, lqip: {} });
  });
});
