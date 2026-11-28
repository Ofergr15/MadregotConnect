import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CHAT_PHOTO_BUCKET, CHAT_PHOTO_SIZES, PHOTO_SIGN_TTL_S, chatPhotoAttachment,
  type ChatPhotoAttachment, type ChatPhotoSize,
} from './photos';

// Group chat photos (task 182) — the sharp + storage half of ./photos.ts.

export interface RenderedChatPhoto { size: ChatPhotoSize; body: Buffer; width: number; height: number }

/**
 * Re-encodes the upload as WebP at every CHAT_PHOTO_SIZES long edge. EXIF orientation is applied
 * first and every other bit of metadata (GPS included) is dropped — sharp writes none unless asked.
 * Never enlarges. Throws on input sharp can't decode; the route turns that into a 415.
 */
export async function renderChatPhoto(input: Buffer): Promise<RenderedChatPhoto[]> {
  const out: RenderedChatPhoto[] = [];
  for (const [size, px] of Object.entries(CHAT_PHOTO_SIZES) as Array<[ChatPhotoSize, number]>) {
    const { data, info } = await sharp(input, { failOn: 'error' })
      .rotate()
      .resize({ width: px, height: px, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: size === 'thumb' ? 70 : 80 })
      .toBuffer({ resolveWithObject: true });
    out.push({ size, body: data, width: info.width, height: info.height });
  }
  return out;
}

/**
 * Uploads every rendered size. All or nothing: a partial set is removed again, so a message never
 * points at a size that isn't there. Returns the attachment, or null when the upload failed.
 */
export async function storeChatPhoto(
  db: SupabaseClient, groupId: string, photoId: string, rendered: RenderedChatPhoto[],
): Promise<ChatPhotoAttachment | null> {
  const full = rendered.find((r) => r.size === 'full');
  const att = chatPhotoAttachment(groupId, photoId, full?.width ?? null, full?.height ?? null);
  const bucket = db.storage.from(CHAT_PHOTO_BUCKET);
  const done: string[] = [];
  for (const r of rendered) {
    const path = att.paths[r.size];
    const { error } = await bucket.upload(path, r.body, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' });
    if (error) {
      console.error('group chat photo upload failed:', path, error.message);
      if (done.length) await bucket.remove(done).catch(() => undefined);
      return null;
    }
    done.push(path);
  }
  return att;
}

export interface SignedChatPhoto {
  photoId: string;
  width: number | null;
  height: number | null;
  urls: Partial<Record<ChatPhotoSize, string>>;
}

/** One createSignedUrls call for every size of every photo. Unsigned paths are simply absent. */
export async function signChatPhotos(db: SupabaseClient, photos: ChatPhotoAttachment[]): Promise<SignedChatPhoto[]> {
  if (!photos.length) return [];
  const paths = photos.flatMap((p) => Object.values(p.paths));
  const { data, error } = await db.storage.from(CHAT_PHOTO_BUCKET).createSignedUrls(paths, PHOTO_SIGN_TTL_S);
  if (error) throw new Error(error.message);
  const byPath = new Map((data ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl]));
  return photos.map((p) => ({
    photoId: p.photo_id,
    width: p.width,
    height: p.height,
    urls: Object.fromEntries(
      (Object.entries(p.paths) as Array<[ChatPhotoSize, string]>).filter(([, path]) => byPath.has(path)).map(([s, path]) => [s, byPath.get(path)!]),
    ),
  }));
}
