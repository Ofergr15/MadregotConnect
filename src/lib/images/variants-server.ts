import sharp from 'sharp';
import { variantPath } from '@/lib/images/variants';

// The sharp half of lib/images/variants.ts: render the WebP copies and upload them.

export type RenderedVariant = { size: number; path: string; body: Buffer; width: number; height: number };

/**
 * Renders WebP variants with sharp. `square` crops to a centred square (avatars);
 * otherwise the long edge is capped (photos). Never enlarges: a 300 px avatar
 * gets a 300 px "512" variant rather than an upscaled one. EXIF orientation is
 * applied first, so an iPhone portrait doesn't come out sideways.
 * Throws on undecodable input — callers treat that as "no variants", not a failed upload.
 */
export async function renderVariants(
  input: Buffer,
  originalPath: string,
  sizes: readonly number[],
  opts: { square: boolean },
): Promise<RenderedVariant[]> {
  const out: RenderedVariant[] = [];
  for (const size of sizes) {
    const pipeline = sharp(input, { failOn: 'error' })
      .rotate()
      .resize(
        opts.square
          ? { width: size, height: size, fit: 'cover', position: 'attention', withoutEnlargement: true }
          : { width: size, height: size, fit: 'inside', withoutEnlargement: true },
      )
      .webp({ quality: 78 });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    out.push({ size, path: variantPath(originalPath, size), body: data, width: info.width, height: info.height });
  }
  return out;
}

type StorageBucket = {
  upload: (
    path: string,
    body: Buffer,
    opts: { contentType: string; upsert: boolean; cacheControl?: string },
  ) => Promise<{ error: { message: string } | null }>;
};

/**
 * Renders and uploads the variants, returning the sizes that made it. Best effort:
 * any failure (HEIC sharp can't decode, a storage error) is logged and that size is
 * left out, so the marker only ever names files that exist.
 */
export async function storeVariants(
  bucket: StorageBucket,
  input: Buffer,
  originalPath: string,
  sizes: readonly number[],
  opts: { square: boolean },
): Promise<number[]> {
  let rendered: RenderedVariant[];
  try {
    rendered = await renderVariants(input, originalPath, sizes, opts);
  } catch (err) {
    console.warn('[images] variant render failed; serving the original only:', (err as Error)?.message);
    return [];
  }
  const done: number[] = [];
  for (const v of rendered) {
    const { error } = await bucket.upload(v.path, v.body, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });
    if (error) console.warn('[images] variant upload failed:', v.path, error.message);
    else done.push(v.size);
  }
  return done;
}
