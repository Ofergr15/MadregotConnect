import { cleanSizes, markedSizes, withVariantMarker } from '@/lib/images/variants';

// The client downscales to a long edge of ~1600px before uploading, so anything much
// larger than this is either a client that skipped the resize or an abuse attempt.
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export function isAllowedMediaType(mimeType: string): boolean {
  return mimeType.startsWith('image/') && ALLOWED_MEDIA_TYPES.includes(mimeType);
}

export function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return 'heic';
  return 'jpg';
}

/**
 * Paths are namespaced by the athlete id taken from the VERIFIED JWT — never
 * from a client-supplied id — so one member cannot write into, or later
 * reference, another's namespace. Shared by /api/feed/posts (POST) and
 * /api/feed/items/[id] (PATCH), which used to each carry their own identical
 * copy of this check — a real risk if only one copy ever got updated.
 */
export function isOwnedMediaPath(path: string, athleteId: string): boolean {
  return path.startsWith(`${athleteId}/`);
}

interface RawMediaDescriptor {
  path?: unknown;
  url?: unknown;
  w?: unknown;
  h?: unknown;
  sizes?: unknown;
}

export type SanitizedMedia = { path: string; w: number | null; h: number | null; sizes: number[] };

/**
 * Validates one client-supplied media descriptor's ownership and shape —
 * everything except resolving the public URL, which needs the Supabase
 * storage client and so stays in the route. Returns null for anything
 * malformed or pointing outside the caller's own namespace.
 */
export function sanitizeMediaDescriptor(
  value: unknown,
  athleteId: string,
): SanitizedMedia | null {
  const rec = value as RawMediaDescriptor;
  if (typeof rec?.path !== 'string' || !isOwnedMediaPath(rec.path, athleteId)) return null;
  // Which sized variants exist (lib/images/variants.ts): from the upload response's
  // `sizes`, or — an edit re-sending a stored item — from the `sz` marker on its url.
  const sizes = cleanSizes(rec.sizes);
  return {
    path: rec.path,
    w: typeof rec.w === 'number' ? rec.w : null,
    h: typeof rec.h === 'number' ? rec.h : null,
    sizes: sizes.length > 0 ? sizes : typeof rec.url === 'string' ? markedSizes(rec.url) : [],
  };
}

/** The stored media entry: the server-built URL, with the variant marker when there are variants. */
export function storedMediaEntry(m: SanitizedMedia, publicUrl: string): { path: string; url: string; w: number | null; h: number | null } {
  return { path: m.path, url: withVariantMarker(publicUrl, m.sizes), w: m.w, h: m.h };
}

/** Applies sanitizeMediaDescriptor across a raw array, dropping invalid entries. */
export function sanitizeMediaList(rawMedia: unknown[], athleteId: string): SanitizedMedia[] {
  return rawMedia
    .map((m) => sanitizeMediaDescriptor(m, athleteId))
    .filter((m): m is SanitizedMedia => m !== null);
}
