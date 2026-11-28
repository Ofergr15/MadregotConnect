/**
 * Sized image variants (task 164).
 *
 * Avatars and feed photos are stored at whatever size the client sent — a member's
 * profile photo straight off an iPhone is a 4032×3024 JPEG drawn into a 34 px circle,
 * dozens of times per feed page. On upload the server now also writes small WebP
 * copies next to the original:
 *
 *   avatars:    <id>.jpg              → sized/<id>@128.webp, sized/<id>@512.webp   (square crop)
 *   feed-media: <athlete>/<uuid>.jpg  → <athlete>/sized/<uuid>@640.webp, …@1080.webp (long edge)
 *
 * A variant sits under the original's own folder, so path-prefix ownership checks
 * (feed-media is namespaced by athlete id) hold for it too.
 *
 * Which sizes exist is written INTO the stored URL as `sz=128-512`. That is the
 * whole contract: no migration, no extra column, and a URL without `sz` (every
 * image uploaded before this, every Strava/Google avatar) is simply drawn as-is by
 * `sizedImageUrl`. A variant that failed to render never gets a marker, so the
 * client never asks for a file that isn't there.
 *
 * This file is pure and safe in client components; the sharp half (render + upload)
 * is in ./variants-server.ts.
 */

export const AVATAR_VARIANT_SIZES = [128, 512] as const;
export const PHOTO_VARIANT_SIZES = [640, 1080] as const;

/** The sizes any caller may claim. Anything else in a marker or a descriptor is dropped. */
const KNOWN_SIZES: ReadonlySet<number> = new Set<number>([...AVATAR_VARIANT_SIZES, ...PHOTO_VARIANT_SIZES]);

/** `a/b/name.jpg` → `a/b/sized/name@640.webp`; `name.jpg` → `sized/name@128.webp`. */
export function variantPath(path: string, size: number): string {
  const slash = path.lastIndexOf('/');
  const dir = slash === -1 ? '' : path.slice(0, slash + 1);
  const file = slash === -1 ? path : path.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  const stem = dot > 0 ? file.slice(0, dot) : file;
  return `${dir}sized/${stem}@${size}.webp`;
}

/** Keeps only known sizes, ascending, deduped. */
export function cleanSizes(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<number>();
  for (const v of raw) if (typeof v === 'number' && KNOWN_SIZES.has(v)) out.add(v);
  return [...out].sort((a, b) => a - b);
}

/** Adds (or replaces) the `sz=` marker. No sizes → the URL unchanged. Keeps other params (`?v=` cache-bust). */
export function withVariantMarker(url: string, sizes: readonly number[]): string {
  const clean = cleanSizes([...sizes]);
  const [base, hash = ''] = url.split('#', 2);
  const q = base.indexOf('?');
  const path = q === -1 ? base : base.slice(0, q);
  const params = new URLSearchParams(q === -1 ? '' : base.slice(q + 1));
  params.delete('sz');
  if (clean.length > 0) params.set('sz', clean.join('-'));
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`;
}

/** The sizes a stored URL says exist (empty for an unmarked URL). */
export function markedSizes(url: string): number[] {
  const m = /[?&]sz=([0-9-]+)/.exec(url);
  if (!m) return [];
  return cleanSizes(m[1].split('-').map(Number));
}

/**
 * The URL to draw at `cssPx` CSS pixels (pass the device pixel ratio for crisp
 * output; default 2). Picks the smallest marked variant at least that big, else the
 * largest one; an unmarked URL is returned unchanged. Recognises both storage URL
 * shapes: Supabase public (`/storage/v1/object/public/<bucket>/<path>`) and the
 * gated file route (`/api/files/<bucket>/<path>`).
 */
export function sizedImageUrl(url: string | null | undefined, cssPx: number, dpr = 2): string | null {
  if (!url) return url ?? null;
  const sizes = markedSizes(url);
  if (sizes.length === 0) return url;
  const want = Math.ceil(cssPx * dpr);
  const size = sizes.find((s) => s >= want) ?? sizes[sizes.length - 1];

  const [base] = url.split('#', 1);
  const q = base.indexOf('?');
  const path = q === -1 ? base : base.slice(0, q);
  const m = /^(.*?\/(?:storage\/v1\/object\/public|api\/files)\/[^/]+\/)(.+)$/.exec(path);
  if (!m) return url;
  // The variant is a different object: the `sz` marker means nothing on it, the cache-bust still does.
  const params = new URLSearchParams(q === -1 ? '' : base.slice(q + 1));
  params.delete('sz');
  const qs = params.toString();
  return `${m[1]}${variantPath(decodeURIComponent(m[2]), size)}${qs ? `?${qs}` : ''}`;
}
