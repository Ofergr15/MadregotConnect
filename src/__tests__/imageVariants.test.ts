import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  AVATAR_VARIANT_SIZES,
  PHOTO_VARIANT_SIZES,
  cleanSizes,
  markedSizes,
  sizedImageUrl,
  variantPath,
  withVariantMarker,
} from '@/lib/images/variants';
import { renderVariants, storeVariants } from '@/lib/images/variants-server';
import { sanitizeMediaDescriptor, storedMediaEntry } from '@/lib/feed/media';

const PUB = 'https://abc.supabase.co/storage/v1/object/public';
const ATH = '11111111-2222-4333-8444-555555555555';

async function jpeg(width: number, height: number, orientation?: number) {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 20 } } }).jpeg();
  if (orientation) img = img.withMetadata({ orientation });
  return img.toBuffer();
}

describe('variantPath', () => {
  it('puts the variant in a sized/ folder under the original’s own folder', () => {
    expect(variantPath(`${ATH}.jpg`, 128)).toBe(`sized/${ATH}@128.webp`);
    expect(variantPath(`${ATH}/abc.heic`, 640)).toBe(`${ATH}/sized/abc@640.webp`);
    expect(variantPath('noext', 128)).toBe('sized/noext@128.webp');
  });
});

describe('marker', () => {
  it('adds sz= next to the cache-bust and reads it back', () => {
    const url = withVariantMarker(`${PUB}/avatars/${ATH}.jpg?v=17`, [512, 128]);
    expect(url).toBe(`${PUB}/avatars/${ATH}.jpg?v=17&sz=128-512`);
    expect(markedSizes(url)).toEqual([128, 512]);
  });
  it('no sizes → URL unchanged; unknown sizes are dropped', () => {
    expect(withVariantMarker(`${PUB}/avatars/x.jpg?v=1`, [])).toBe(`${PUB}/avatars/x.jpg?v=1`);
    expect(cleanSizes([128, 999, '512', 640, 640])).toEqual([128, 640]);
    expect(markedSizes('https://x/y.jpg?sz=7-128')).toEqual([128]);
  });
});

describe('sizedImageUrl', () => {
  const marked = `${PUB}/avatars/${ATH}.jpg?v=17&sz=128-512`;
  it('picks the smallest variant ≥ px × dpr, keeps the cache-bust, drops sz', () => {
    expect(sizedImageUrl(marked, 34)).toBe(`${PUB}/avatars/sized/${ATH}@128.webp?v=17`);
    expect(sizedImageUrl(marked, 76)).toBe(`${PUB}/avatars/sized/${ATH}@512.webp?v=17`);
    expect(sizedImageUrl(marked, 400)).toBe(`${PUB}/avatars/sized/${ATH}@512.webp?v=17`); // largest when none is big enough
  });
  it('works on the gated /api/files URL shape too', () => {
    expect(sizedImageUrl(`/api/files/feed-media/${ATH}/p.jpg?sz=640-1080`, 200)).toBe(`/api/files/feed-media/${ATH}/sized/p@640.webp`);
    expect(sizedImageUrl(`/api/files/feed-media/${ATH}/p.jpg?sz=640-1080`, 390)).toBe(`/api/files/feed-media/${ATH}/sized/p@1080.webp`);
  });
  it('leaves unmarked and foreign URLs alone (old uploads, Strava/Google avatars)', () => {
    expect(sizedImageUrl(`${PUB}/avatars/${ATH}.jpg?v=3`, 34)).toBe(`${PUB}/avatars/${ATH}.jpg?v=3`);
    expect(sizedImageUrl('https://dgalywyr863hv.cloudfront.net/pictures/athletes/1/large.jpg?sz=128', 34)).toBe(
      'https://dgalywyr863hv.cloudfront.net/pictures/athletes/1/large.jpg?sz=128',
    );
    expect(sizedImageUrl(null, 34)).toBeNull();
  });
});

describe('renderVariants', () => {
  it('avatars: centred square WebP at each size', async () => {
    const out = await renderVariants(await jpeg(1200, 800), `${ATH}.jpg`, AVATAR_VARIANT_SIZES, { square: true });
    expect(out.map((v) => [v.size, v.width, v.height, v.path])).toEqual([
      [128, 128, 128, `sized/${ATH}@128.webp`],
      [512, 512, 512, `sized/${ATH}@512.webp`],
    ]);
    expect((await sharp(out[0].body).metadata()).format).toBe('webp');
  });
  it('photos: long edge capped, aspect kept', async () => {
    const out = await renderVariants(await jpeg(1600, 1200), `${ATH}/p.jpg`, PHOTO_VARIANT_SIZES, { square: false });
    expect(out.map((v) => [v.width, v.height])).toEqual([[640, 480], [1080, 810]]);
  });
  it('never enlarges a small source', async () => {
    const out = await renderVariants(await jpeg(300, 300), 'x.jpg', [512], { square: true });
    expect([out[0].width, out[0].height]).toEqual([300, 300]);
  });
  it('applies EXIF orientation (iPhone portrait stays portrait)', async () => {
    // Stored landscape 800×600 with orientation 6 (rotate 90°) → displayed 600×800.
    const out = await renderVariants(await jpeg(800, 600, 6), 'p.jpg', [640], { square: false });
    expect([out[0].width, out[0].height]).toEqual([480, 640]);
  });
  it('throws on bytes that are not an image', async () => {
    await expect(renderVariants(Buffer.from('not an image'), 'x.jpg', [128], { square: true })).rejects.toThrow();
  });
});

describe('storeVariants', () => {
  it('uploads each variant as webp and returns the sizes that made it', async () => {
    const upload = vi.fn(async (path: string, _body: Buffer, _opts: { contentType: string; upsert: boolean }) => ({ error: path.includes('@512') ? { message: 'boom' } : null }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sizes = await storeVariants({ upload }, await jpeg(600, 600), `${ATH}.jpg`, AVATAR_VARIANT_SIZES, { square: true });
    expect(sizes).toEqual([128]);
    expect(upload.mock.calls.map((c) => [c[0], c[2].contentType])).toEqual([
      [`sized/${ATH}@128.webp`, 'image/webp'],
      [`sized/${ATH}@512.webp`, 'image/webp'],
    ]);
    warn.mockRestore();
  });
  it('an undecodable upload (e.g. HEIC sharp cannot read) → no variants, no upload, no throw', async () => {
    const upload = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await storeVariants({ upload }, Buffer.from('heic?'), 'x.heic', [128], { square: true })).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('feed media descriptors carry the variants into the stored URL', () => {
  it('sizes from the upload response', () => {
    const m = sanitizeMediaDescriptor({ path: `${ATH}/p.jpg`, url: 'ignored', w: 1600, h: 1200, sizes: [640, 1080, 4096] }, ATH)!;
    expect(m.sizes).toEqual([640, 1080]);
    expect(storedMediaEntry(m, `${PUB}/feed-media/${ATH}/p.jpg`)).toEqual({
      path: `${ATH}/p.jpg`, url: `${PUB}/feed-media/${ATH}/p.jpg?sz=640-1080`, w: 1600, h: 1200,
    });
  });
  it('an edit re-sending a stored item keeps its marker; an old item stays unmarked', () => {
    const kept = sanitizeMediaDescriptor({ path: `${ATH}/p.jpg`, url: `${PUB}/feed-media/${ATH}/p.jpg?sz=640`, w: null, h: null }, ATH)!;
    expect(storedMediaEntry(kept, `${PUB}/feed-media/${ATH}/p.jpg`).url).toBe(`${PUB}/feed-media/${ATH}/p.jpg?sz=640`);
    const old = sanitizeMediaDescriptor({ path: `${ATH}/q.jpg`, url: `${PUB}/feed-media/${ATH}/q.jpg` }, ATH)!;
    expect(storedMediaEntry(old, `${PUB}/feed-media/${ATH}/q.jpg`).url).toBe(`${PUB}/feed-media/${ATH}/q.jpg`);
  });
  it('another member’s path is still refused', () => {
    expect(sanitizeMediaDescriptor({ path: 'someone-else/p.jpg', sizes: [640] }, ATH)).toBeNull();
  });
});
