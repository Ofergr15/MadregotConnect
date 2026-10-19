import { createHmac, timingSafeEqual } from 'crypto';
import { google, type drive_v3 } from 'googleapis';
import { unstable_cache } from 'next/cache';
import { cleanTitle, folderDay, isPinned, isScratchFolder } from './folder-names';

/**
 * The photos module (/dashboard/photos, mockup ~/.cache/madregot/photos-module.html,
 * Ofer 2026-10-18): the club's photo folders in Drive, browsed live.
 *
 * The root is the club's photos folder the quality-session automation already writes
 * into (SESSION_PHOTOS_DRIVE_FOLDER_ID, "Madregot_After_2KM"); every subfolder of it is
 * a session or an event. Read with the same service account, read-only scope.
 *
 * Images reach the browser through /api/photos/browse/img with a SIGNED, expiring
 * URL: an <img> cannot send the bearer token, and the files must stay club-only. The
 * signature binds the file id and the size, so a link can't be widened to another
 * file, and it expires (IMAGE_URL_TTL) so a copied link stops working.
 */

const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const THUMB = 480;
export const FULL = 1600;
const SIZES = new Set([THUMB, FULL]);
const IMAGE_URL_TTL = 60 * 60 * 6;
/** A full listing is ~180 Drive calls (one per folder — Drive returns nothing for an OR across parents here). */
const LIST_REVALIDATE_S = 10 * 60;
const CONCURRENCY = 12;
const MAX_DEPTH = 3;

export interface PhotoFolder { id: string; name: string; title: string | null; date: string; count: number; covers: string[]; pinned: boolean }
export interface FolderPhoto { id: string; w: number | null; h: number | null; at: string | null }

export function photosRoot(): string | null {
  return process.env.SESSION_PHOTOS_DRIVE_FOLDER_ID || null;
}

let auth: InstanceType<typeof google.auth.JWT> | null = null;
function driveReader(): drive_v3.Drive | null {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key || !photosRoot()) return null;
  auth ??= new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  return google.drive({ version: 'v3', auth });
}

async function listAll(drive: drive_v3.Drive, q: string, fields: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({ q, fields: `nextPageToken,files(${fields})`, pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true });
    out.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/**
 * Every photo in a folder, its subfolders included — the videographer's
 * "צילומים שני" subfolder is often where a session's only photos are. In capture order.
 */
async function folderPhotos(drive: drive_v3.Drive, folderId: string, depth = 0): Promise<FolderPhoto[]> {
  const files = await listAll(drive, `'${folderId}' in parents and trashed = false and (mimeType contains 'image/' or mimeType = '${FOLDER_MIME}')`,
    'id,mimeType,createdTime,imageMediaMetadata(width,height,time)').catch(() => []);
  const photos: FolderPhoto[] = files.filter((f) => f.mimeType?.startsWith('image/')).map((f) => ({
    id: f.id!,
    w: f.imageMediaMetadata?.width ?? null,
    h: f.imageMediaMetadata?.height ?? null,
    at: f.imageMediaMetadata?.time || f.createdTime || null,
  }));
  if (depth < MAX_DEPTH) {
    for (const sub of files.filter((f) => f.mimeType === FOLDER_MIME)) photos.push(...await folderPhotos(drive, sub.id!, depth + 1));
  }
  // EXIF time is "2026:10:16 07:12:03", createdTime ISO — both sort as text once the colons in the date agree.
  const key = (p: FolderPhoto) => (p.at || '').replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  return photos.sort((a, b) => key(a).localeCompare(key(b)));
}

interface Library { folders: PhotoFolder[]; photos: Record<string, FolderPhoto[]> }

async function loadLibrary(): Promise<Library | null> {
  const drive = driveReader();
  const root = photosRoot();
  if (!drive || !root) return null;
  const top = await listAll(drive, `'${root}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`, 'id,name,createdTime,appProperties');
  const photos: Record<string, FolderPhoto[]> = {};
  const folders = await pool(top.filter((f) => !isScratchFolder(f.name || '')), CONCURRENCY, async (f) => {
    const list = await folderPhotos(drive, f.id!);
    photos[f.id!] = list;
    const name = (f.name || '').trim();
    return {
      id: f.id!,
      name,
      title: cleanTitle(name),
      date: folderDay({ name, createdTime: f.createdTime, tag: f.appProperties?.madregotSessionDate, photoTimes: list.map((p) => p.at) }),
      count: list.length,
      covers: list.slice(0, 3).map((p) => p.id),
      pinned: isPinned(name),
    };
  });
  const shown = folders.filter((f) => f.count > 0).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.date.localeCompare(a.date));
  return { folders: shown, photos: Object.fromEntries(shown.map((f) => [f.id, photos[f.id]])) };
}

// Shared across server instances (a cold listing takes ~10s), refreshed every 10 minutes;
// plus a per-instance copy so one request doesn't read it twice.
const cachedLibrary = unstable_cache(loadLibrary, ['photos-library-v2'], { revalidate: LIST_REVALIDATE_S });
let local: { at: number; value: Library | null } | null = null;
async function library(): Promise<Library | null> {
  if (local && Date.now() - local.at < 60_000) return local.value;
  const value = await cachedLibrary();
  local = { at: Date.now(), value };
  return value;
}

/** Every photo's id, folder by folder in the order the screen shows them (pinned, then newest). */
export async function listAllPhotoIds(): Promise<string[]> {
  const lib = await library();
  return lib ? lib.folders.flatMap((f) => (lib.photos[f.id] ?? []).map((p) => p.id)) : [];
}

/** Every photo folder under the root: pinned first, then newest first. */
export async function listPhotoFolders(): Promise<PhotoFolder[] | null> {
  return (await library())?.folders ?? null;
}

export async function listFolderPhotos(folderId: string): Promise<{ folder: PhotoFolder; photos: FolderPhoto[] } | null> {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) return null;
  const lib = await library();
  const folder = lib?.folders.find((f) => f.id === folderId);
  return folder && lib ? { folder, photos: lib.photos[folder.id] ?? [] } : null;
}

/**
 * The image bytes at `size` px. Only ever called behind a valid signature, and
 * signatures are only minted for files the browse routes listed out of the root's
 * own folders — that is the containment check. (Drive does not return `parents` to
 * the service account for these files, so the file can't be re-checked here.)
 */
export async function fetchPhotoImage(fileId: string, size: number): Promise<{ body: ReadableStream<Uint8Array>; type: string } | null> {
  if (!SIZES.has(size)) return null;
  return fetchDriveThumbnail(fileId, size);
}

/**
 * Drive's own rendition of a photo at `size` px — the image route's (sizes limited
 * there) and the background copy's (lib/photos/mirror.ts, which also takes a tiny one
 * for the blurred preview). Server-side only, never reachable with a size from a URL.
 */
export async function fetchDriveThumbnail(fileId: string, size: number): Promise<{ body: ReadableStream<Uint8Array>; type: string } | null> {
  const drive = driveReader();
  if (!drive || !Number.isInteger(size) || size < 16 || size > 2048 || !/^[A-Za-z0-9_-]{10,}$/.test(fileId)) return null;
  const meta = await drive.files.get({ fileId, fields: 'thumbnailLink,mimeType', supportsAllDrives: true }).then((r) => r.data).catch(() => null);
  if (!meta?.thumbnailLink || !meta.mimeType?.startsWith('image/')) return null;
  const token = (await auth!.getAccessToken()).token;
  const url = meta.thumbnailLink.replace(/=s\d+(-[a-z]+)?$/, `=s${size}`);
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok || !res.body) return null;
  // Streamed, not buffered: the phone starts receiving while Drive is still sending.
  return { body: res.body, type: res.headers.get('content-type') || 'image/jpeg' };
}

// ── Signed image URLs ──────────────────────────────────────────────────────────

const LABEL = 'photo-url-v1';
function sign(payload: string): string | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return null;
  return createHmac('sha256', `${LABEL}:${key}`).update(payload).digest('base64url').slice(0, 32);
}

/** `/api/photos/browse/img?…` for one file at one size, valid for IMAGE_URL_TTL. */
export function signedImageUrl(fileId: string, size: number, now = Date.now()): string | null {
  const exp = Math.floor(now / 1000) + IMAGE_URL_TTL;
  // Rounded up to a 6-hour boundary, so the URL of a photo stays the same for six
  // hours: the browser's cache and the CDN's (img route) can then actually be hit.
  // An hour's rounding minted a new URL — a cache miss and two Drive round trips —
  // for every photo every hour. A link still expires, between 6 and 12 hours out.
  const e = Math.ceil(exp / IMAGE_URL_TTL) * IMAGE_URL_TTL;
  const sig = sign(`${fileId}.${size}.${e}`);
  return sig ? `/api/photos/browse/img?id=${encodeURIComponent(fileId)}&s=${size}&e=${e}&sig=${sig}` : null;
}

export function verifyImageUrl(fileId: string, size: number, exp: number, sig: string, now = Date.now()): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(now / 1000)) return false;
  const want = sign(`${fileId}.${size}.${exp}`);
  if (!want || want.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}
