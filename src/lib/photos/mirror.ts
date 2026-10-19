import { revalidateTag, unstable_cache } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { FULL, THUMB, fetchDriveThumbnail, listAllPhotoIds } from './drive-browse';

/**
 * The club's Drive photos, copied into our own storage so a member's phone never
 * waits for Drive (2026-10-19, "something very very fast here").
 *
 * Without it every photo was a function + two Drive round trips (the thumbnail link,
 * then the bytes), about a second each on a first view. With it: a private bucket,
 * each photo at the grid size and the viewer size, served from Supabase's CDN under a
 * signed link, plus a tiny blurred preview the listing carries inline, so the grid has
 * something to show before a single image has arrived.
 *
 * - The copy runs in the background (/api/cron/photos-mirror), a batch per run, and only
 *   while app_settings `photos_mirror` is 'on'. Nothing here is on a request's path
 *   except reading what has been copied (`mirroredUrls`), and a photo not copied yet
 *   simply keeps its Drive link (lib/photos/drive-browse signedImageUrl).
 * - What has been copied is one JSON object in the bucket (MANIFEST): no migration.
 * - Links are signed for SIGN_TTL and the set is cached for half that, so a photo's
 *   URL stays the same for hours: the browser's cache and the CDN's are hit, and a
 *   copied link still stops working.
 */
export const PHOTO_BUCKET = 'club-photos';
const MANIFEST = 'manifest.json';
/** The blurred stand-in: tiny, inline in the listing (data URL, ~1 KB). */
const LQIP_PX = 24;
const SIGN_TTL = 7 * 24 * 3600;
const SIGN_CACHE_S = 12 * 3600;

export interface MirrorEntry { t?: 1; f?: 1; q?: string }
export interface Manifest { v: 1; files: Record<string, MirrorEntry> }

const pathOf = (fileId: string, size: number) => `${size === FULL ? 'f' : 't'}/${fileId}.jpg`;

async function readManifest(): Promise<Manifest> {
  const db = createServerClient();
  const { data } = await db.storage.from(PHOTO_BUCKET).download(MANIFEST);
  if (!data) return { v: 1, files: {} };
  try {
    const m = JSON.parse(await data.text()) as Manifest;
    return m?.v === 1 && m.files && typeof m.files === 'object' ? m : { v: 1, files: {} };
  } catch {
    return { v: 1, files: {} };
  }
}

async function writeManifest(m: Manifest): Promise<void> {
  const db = createServerClient();
  await db.storage.from(PHOTO_BUCKET).upload(MANIFEST, JSON.stringify(m), {
    contentType: 'application/json', upsert: true, cacheControl: '0',
  });
}

/** Shared across instances; the cron writes it, a few minutes of staleness only delays a new photo. */
const cachedManifest = unstable_cache(readManifest, ['photos-mirror-manifest-v1'], { revalidate: 300, tags: ['photos-mirror'] });

export interface MirroredUrls { thumb: Record<string, string>; full: Record<string, string>; lqip: Record<string, string> }

/** Signed links for the copied photos among `ids`, cached so a URL stays put for hours. */
const signedFor = unstable_cache(async (ids: string[]): Promise<MirroredUrls> => {
  const out: MirroredUrls = { thumb: {}, full: {}, lqip: {} };
  if (!ids.length) return out;
  const m = await cachedManifest();
  const paths: string[] = [];
  for (const id of ids) {
    const e = m.files[id];
    if (!e) continue;
    if (e.q) out.lqip[id] = e.q;
    if (e.t) paths.push(pathOf(id, THUMB));
    if (e.f) paths.push(pathOf(id, FULL));
  }
  if (!paths.length) return out;
  const db = createServerClient();
  const { data } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(paths, SIGN_TTL);
  for (const s of data ?? []) {
    if (!s.signedUrl || !s.path) continue;
    const [kind, file] = s.path.split('/');
    const id = file.replace(/\.jpg$/, '');
    (kind === 'f' ? out.full : out.thumb)[id] = s.signedUrl;
  }
  return out;
}, ['photos-mirror-signed-v1'], { revalidate: SIGN_CACHE_S, tags: ['photos-mirror'] });

/**
 * The copied photos' links for these ids. Empty, never an error: a photo that isn't
 * copied (or a storage hiccup) falls back to its Drive link.
 */
export async function mirroredUrls(ids: string[]): Promise<MirroredUrls> {
  try {
    return await signedFor([...new Set(ids)].sort());
  } catch (err) {
    console.warn('photos mirror: links unavailable', err);
    return { thumb: {}, full: {}, lqip: {} };
  }
}

async function toBase64(stream: ReadableStream<Uint8Array>): Promise<string> {
  return Buffer.from(await new Response(stream).arrayBuffer()).toString('base64');
}

/** Photos copied at the same time: each is a few Drive round trips, mostly waiting. */
const PARALLEL = 6;
/**
 * The full (viewer) size is kept for the newest this many photos only (10-19): the grid
 * and the blurred stand-in are what make the module feel fast, at ~40 KB a photo for
 * every photo; the ~300 KB viewer copy for the whole archive would be gigabytes, and an
 * old photo opened full screen can wait for Drive once.
 */
export const FULL_FOR_NEWEST = 1500;

/**
 * The background copy, until `deadline`. Two passes, both newest folders first: first the
 * grid size and the blurred stand-in for every photo, then the viewer size for the newest
 * FULL_FOR_NEWEST. Six at a time. Returns what it did.
 */
export async function mirrorBatch(deadline: number): Promise<{ copied: number; failed: number; remaining: number }> {
  const db = createServerClient();
  const { error: bucketError } = await db.storage.createBucket(PHOTO_BUCKET, { public: false });
  if (bucketError && !/exist/i.test(bucketError.message)) throw bucketError;

  const m = await readManifest();
  const ids = await listAllPhotoIds();
  const newest = new Set(ids.slice(0, FULL_FOR_NEWEST));
  const needsGrid = (id: string) => { const e = m.files[id]; return !e?.t || !e?.q; };
  const needsFull = (id: string) => newest.has(id) && !m.files[id]?.f;
  const todo = [...ids.filter(needsGrid), ...ids.filter((id) => !needsGrid(id) && needsFull(id))];

  const upload = async (id: string, size: number) => {
    const img = await fetchDriveThumbnail(id, size);
    if (!img) throw new Error('no image');
    const { error } = await db.storage.from(PHOTO_BUCKET).upload(pathOf(id, size), await new Response(img.body).arrayBuffer(), {
      contentType: img.type, upsert: true, cacheControl: '31536000',
    });
    if (error) throw error;
  };
  const one = async (id: string) => {
    const e: MirrorEntry = { ...m.files[id] };
    if (!e.t) { await upload(id, THUMB); e.t = 1; }
    if (!e.q) {
      const tiny = await fetchDriveThumbnail(id, LQIP_PX);
      if (tiny) e.q = `data:${tiny.type};base64,${await toBase64(tiny.body)}`;
    }
    // The viewer size comes after the grid copies because `todo` lists those first; never
    // "once every photo has one", which a single photo Drive will not serve would block forever.
    if (!e.f && newest.has(id) && e.t) { await upload(id, FULL); e.f = 1; }
    m.files[id] = e;
  };

  let copied = 0, failed = 0, dirty = 0, i = 0;
  while (i < todo.length && Date.now() < deadline) {
    const chunk = todo.slice(i, i + PARALLEL);
    i += chunk.length;
    const done = await Promise.allSettled(chunk.map(one));
    for (const d of done) { if (d.status === 'fulfilled') { copied++; dirty++; } else failed++; }
    // Saved as it goes, so a run cut short by its deadline keeps what it did.
    if (dirty >= 30) { await writeManifest(m); dirty = 0; }
  }
  if (dirty) await writeManifest(m);
  // The listings pick the new copies up now, not after their cache runs out.
  if (copied) revalidateTag('photos-mirror', { expire: 0 });
  const left = ids.filter((id) => needsGrid(id) || needsFull(id)).length;
  return { copied, failed, remaining: left };
}
