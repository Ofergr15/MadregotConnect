import { revalidateTag, unstable_cache } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { FULL, THUMB, fetchDriveThumbnail, listAllPhotoIds, listAllVideoIds } from './drive-browse';

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
/** Full-size posters for this many of the newest videos (folders newest first). */
const FULL_FOR_NEWEST_VIDEOS = 600;

export interface MirrorEntry { t?: 1; f?: 1; q?: string }
export interface Manifest { v: 1; files: Record<string, MirrorEntry> }

const pathOf = (fileId: string, size: number) => `${size === FULL ? 'f' : 't'}/${fileId}.jpg`;

// ── Where the record of what is copied lives (10-19 rework) ─────────────────────────
// It was ONE file with every photo's blurred stand-in inside: 7 MB at 6,400 photos.
// Next's data cache keeps nothing over 2 MB, so it was never cached, and every photos
// page made the server download all 7 MB first (12 s measured). Now:
//   FLAGS            which photos have which size: two id lists, ~150 KB, cached.
//   lqip/<n>.json    the stand-ins, in 64 shards by a hash of the id: a page
//                    reads only the shards of the photos it shows, each well under 2 MB.
// The old MANIFEST is still read once, by the first copy run after this, and replaced.
const FLAGS = 'flags.json';
const LQIP_DIR = 'lqip';
interface Flags { v: 2; t: string[]; f: string[] }
// By a hash of the id, not its first character: Drive ids nearly all start with "1".
const shardOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `${LQIP_DIR}/${h % 64}.json`;
};

async function downloadJson<T>(path: string): Promise<T | null> {
  const db = createServerClient();
  const { data } = await db.storage.from(PHOTO_BUCKET).download(path);
  if (!data) return null;
  try { return JSON.parse(await data.text()) as T; } catch { return null; }
}
async function uploadJson(path: string, value: unknown): Promise<void> {
  const db = createServerClient();
  await db.storage.from(PHOTO_BUCKET).upload(path, JSON.stringify(value), { contentType: 'application/json', upsert: true, cacheControl: '0' });
}

async function readFlags(): Promise<Flags | null> {
  const f = await downloadJson<Flags>(FLAGS);
  return f?.v === 2 && Array.isArray(f.t) && Array.isArray(f.f) ? f : null;
}

/** The whole record, for the copy job only (it reads every shard). */
async function readManifest(): Promise<Manifest & { legacy?: boolean }> {
  const flags = await readFlags();
  if (!flags) {
    const old = await downloadJson<Manifest>(MANIFEST);
    return old?.v === 1 && old.files && typeof old.files === 'object' ? { ...old, legacy: true } : { v: 1, files: {} };
  }
  const files: Record<string, MirrorEntry> = {};
  for (const id of flags.t) (files[id] ||= {}).t = 1;
  for (const id of flags.f) (files[id] ||= {}).f = 1;
  const shards = [...new Set(Object.keys(files).map(shardOf))];
  const read = await Promise.all(shards.map((p) => downloadJson<Record<string, string>>(p)));
  for (const shard of read) for (const [id, q] of Object.entries(shard || {})) (files[id] ||= {}).q = q;
  return { v: 1, files };
}

/** Writes the flags, and the stand-in shards of `changed` (every shard when unset). */
async function writeManifest(m: Manifest, changed?: Iterable<string>): Promise<void> {
  const ids = Object.keys(m.files);
  await uploadJson(FLAGS, { v: 2, t: ids.filter((id) => m.files[id].t), f: ids.filter((id) => m.files[id].f) } satisfies Flags);
  const touched = changed ? new Set([...changed].map(shardOf)) : new Set(ids.map(shardOf));
  const byShard = new Map<string, Record<string, string>>();
  for (const id of ids) {
    const sh = shardOf(id);
    if (!touched.has(sh) || !m.files[id].q) continue;
    (byShard.get(sh) ?? byShard.set(sh, {}).get(sh)!)[id] = m.files[id].q!;
  }
  await Promise.all([...byShard].map(([p, v]) => uploadJson(p, v)));
}

/** Shared across instances; the cron writes them, a few minutes of staleness only delays a new photo. */
const cachedFlags = unstable_cache(readFlags, ['photos-mirror-flags-v2'], { revalidate: 300, tags: ['photos-mirror'] });
const cachedShard = unstable_cache((path: string) => downloadJson<Record<string, string>>(path), ['photos-mirror-lqip-v2'], { revalidate: 3600, tags: ['photos-mirror'] });

export interface MirroredUrls { thumb: Record<string, string>; full: Record<string, string>; lqip: Record<string, string> }

/** Signed links for the copied photos among `ids`, cached so a URL stays put for hours. */
const signedFor = unstable_cache(async (ids: string[]): Promise<MirroredUrls> => {
  const out: MirroredUrls = { thumb: {}, full: {}, lqip: {} };
  if (!ids.length) return out;
  const flags = await cachedFlags();
  if (!flags) return out;
  const t = new Set(flags.t), f = new Set(flags.f);
  const wanted = ids.filter((id) => t.has(id));
  const shards = await Promise.all([...new Set(wanted.map(shardOf))].map(async (p) => [p, await cachedShard(p)] as const));
  const q = new Map(shards);
  const paths: string[] = [];
  for (const id of ids) {
    const lq = q.get(shardOf(id))?.[id];
    if (lq) out.lqip[id] = lq;
    if (t.has(id)) paths.push(pathOf(id, THUMB));
    if (f.has(id)) paths.push(pathOf(id, FULL));
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
}, ['photos-mirror-signed-v2'], { revalidate: SIGN_CACHE_S, tags: ['photos-mirror'] });

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
  const photoIds = await listAllPhotoIds();
  // The videos' posters too (2026-10-23), after the photos: the grid of a video folder then
  // loads from our copy like a photo folder does, not from Drive one tile at a time — and
  // the newest videos' FULL poster, the still the player shows the instant a video lands
  // ("people see at once whether they are in it", Ofer).
  const videoIds = await listAllVideoIds().catch(() => [] as string[]);
  const newest = new Set([...photoIds.slice(0, FULL_FOR_NEWEST), ...videoIds.slice(0, FULL_FOR_NEWEST_VIDEOS)]);
  const ids = [...photoIds, ...videoIds];
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
  const changed = new Set<string>();
  // The first run after the rework: write the new record at once, even with nothing to copy.
  if (m.legacy) { await writeManifest(m); revalidateTag('photos-mirror', { expire: 0 }); }
  while (i < todo.length && Date.now() < deadline) {
    const chunk = todo.slice(i, i + PARALLEL);
    i += chunk.length;
    const done = await Promise.allSettled(chunk.map(one));
    done.forEach((d, k) => { if (d.status === 'fulfilled') { copied++; dirty++; changed.add(chunk[k]); } else failed++; });
    // Saved as it goes, so a run cut short by its deadline keeps what it did.
    if (dirty >= 30) { await writeManifest(m, changed); dirty = 0; changed.clear(); }
  }
  if (dirty) await writeManifest(m, changed);
  // The listings pick the new copies up now, not after their cache runs out.
  if (copied) revalidateTag('photos-mirror', { expire: 0 });
  const left = ids.filter((id) => needsGrid(id) || needsFull(id)).length;
  return { copied, failed, remaining: left };
}


/**
 * Every folder's links and blurred previews, made ahead of anyone asking (run by the copy
 * job after each batch, 10-19). A folder's first open used to wait 1.7-3 s for them
 * (measured); the caches above then hold them for hours, so this mostly re-reads hits.
 */
export async function warmMirrorCache(folders: string[][], deadline: number): Promise<number> {
  await cachedFlags();
  await Promise.all(Array.from({ length: 64 }, (_, i) => cachedShard(`${LQIP_DIR}/${i}.json`)));
  let warmed = 0;
  for (let i = 0; i < folders.length && Date.now() < deadline; i += 6) {
    await Promise.all(folders.slice(i, i + 6).map((ids) => mirroredUrls(ids).catch(() => null)));
    warmed += Math.min(6, folders.length - i);
  }
  return warmed;
}
