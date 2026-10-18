import { createHmac, timingSafeEqual } from 'crypto';
import { google, type drive_v3 } from 'googleapis';

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
const CACHE_MS = 5 * 60 * 1000;

export interface PhotoFolder { id: string; name: string; date: string; count: number; covers: string[] }
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

// ── A small per-instance cache: Drive listings are slow and the folders change rarely ──
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** A folder's date: the automation's appProperty when it made it, else when it was created. */
export function folderDate(f: { createdTime?: string | null; appProperties?: Record<string, string> | null }): string {
  const tagged = f.appProperties?.madregotSessionDate;
  if (tagged && /^\d{4}-\d{2}-\d{2}$/.test(tagged)) return tagged;
  return (f.createdTime || '').slice(0, 10);
}

/** Every non-empty photo folder under the root, newest first, with three cover images. */
export async function listPhotoFolders(): Promise<PhotoFolder[] | null> {
  const drive = driveReader();
  const root = photosRoot();
  if (!drive || !root) return null;
  return cached('folders', async () => {
    const res = await drive.files.list({
      q: `'${root}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id,name,createdTime,appProperties)',
      pageSize: 200,
      orderBy: 'createdTime desc',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const folders = res.data.files ?? [];
    const filled = await Promise.all(folders.slice(0, 80).map(async (f) => {
      const imgs = await drive.files.list({
        q: `'${f.id}' in parents and mimeType contains 'image/' and trashed = false`,
        fields: 'files(id)',
        pageSize: 1000,
        orderBy: 'createdTime',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      }).then((r) => r.data.files ?? []).catch(() => []);
      return { id: f.id!, name: (f.name || '').trim(), date: folderDate(f), count: imgs.length, covers: imgs.slice(0, 3).map((i) => i.id!) };
    }));
    return filled.filter((f) => f.count > 0).sort((a, b) => b.date.localeCompare(a.date));
  });
}

export async function listFolderPhotos(folderId: string): Promise<{ folder: PhotoFolder; photos: FolderPhoto[] } | null> {
  const drive = driveReader();
  if (!drive || !/^[A-Za-z0-9_-]{10,}$/.test(folderId)) return null;
  const folders = await listPhotoFolders();
  const folder = folders?.find((f) => f.id === folderId);
  if (!folder) return null;
  return cached(`folder:${folderId}`, async () => {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: 'files(id,createdTime,imageMediaMetadata(width,height,time))',
      pageSize: 1000,
      orderBy: 'createdTime',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const photos = (res.data.files ?? []).map((f) => ({
      id: f.id!,
      w: f.imageMediaMetadata?.width ?? null,
      h: f.imageMediaMetadata?.height ?? null,
      at: f.imageMediaMetadata?.time || f.createdTime || null,
    }));
    return { folder, photos };
  });
}

/**
 * The image bytes at `size` px. Only ever called behind a valid signature, and
 * signatures are only minted for files the browse routes listed out of the root's
 * own folders — that is the containment check. (Drive does not return `parents` to
 * the service account for these files, so the file can't be re-checked here.)
 */
export async function fetchPhotoImage(fileId: string, size: number): Promise<{ body: ArrayBuffer; type: string } | null> {
  const drive = driveReader();
  if (!drive || !SIZES.has(size) || !/^[A-Za-z0-9_-]{10,}$/.test(fileId)) return null;
  const meta = await drive.files.get({ fileId, fields: 'thumbnailLink,mimeType', supportsAllDrives: true }).then((r) => r.data).catch(() => null);
  if (!meta?.thumbnailLink || !meta.mimeType?.startsWith('image/')) return null;
  const token = (await auth!.getAccessToken()).token;
  const url = meta.thumbnailLink.replace(/=s\d+(-[a-z]+)?$/, `=s${size}`);
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) return null;
  return { body: await res.arrayBuffer(), type: res.headers.get('content-type') || 'image/jpeg' };
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
  // Rounded to the hour so a re-render inside the hour reuses the browser's cache.
  const e = Math.ceil(exp / 3600) * 3600;
  const sig = sign(`${fileId}.${size}.${e}`);
  return sig ? `/api/photos/browse/img?id=${encodeURIComponent(fileId)}&s=${size}&e=${e}&sig=${sig}` : null;
}

export function verifyImageUrl(fileId: string, size: number, exp: number, sig: string, now = Date.now()): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(now / 1000)) return false;
  const want = sign(`${fileId}.${size}.${exp}`);
  if (!want || want.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}
