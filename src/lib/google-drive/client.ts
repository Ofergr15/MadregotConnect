/**
 * Google Drive client for importing run photos.
 *
 * Folder structure: root folder → one subfolder per run (e.g. "שישי 24.7")
 * → images inside. Photos are NOT directly in the root.
 *
 * Authentication: service account JWT. The service account email needs
 * read access to the Drive folder — share the root folder with it once.
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   (RSA key from the JSON key file)
 *   GOOGLE_DRIVE_FOLDER_ID               (the root folder)
 */

import { google } from 'googleapis';

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID!;

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error(
      'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'
    );
  }
  return new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

function getDrive() {
  return google.drive({ version: 'v3', auth: getAuth() });
}

export interface RunFolder {
  id: string;       // Drive folder ID — used as the key in import/process calls
  name: string;     // Display name, e.g. "שישי 24.7"
  date: string;     // YYYY-MM-DD derived from createdTime
  totalPhotos: number; // number of image files in this subfolder
}

export interface DrivePhoto {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  webViewLink: string;
  webContentLink?: string;
  thumbnailLink?: string;
  imageMediaMetadata?: { width: number; height: number };
}

/**
 * Returns subfolders of the root folder — one per run date.
 * These are what the Import tab shows in its picker.
 */
export async function listRunFolders(): Promise<RunFolder[]> {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `'${ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,name,createdTime)',
    pageSize: 200,
    orderBy: 'createdTime desc',
  });

  const folders = (res.data.files ?? []).map(f => ({
    id: f.id!,
    name: f.name ?? '',
    date: (f.createdTime ?? '').slice(0, 10),
  }));

  // Fetch photo counts for all folders in parallel (lightweight — only IDs returned)
  const counts = await Promise.allSettled(
    folders.map(f =>
      drive.files.list({
        q: `'${f.id}' in parents and mimeType contains 'image/' and trashed = false`,
        fields: 'files(id)',
        pageSize: 1000,
      }).then(r => r.data.files?.length ?? 0)
    )
  );

  return folders.map((f, i) => ({
    ...f,
    totalPhotos: counts[i].status === 'fulfilled'
      ? (counts[i] as PromiseFulfilledResult<number>).value
      : 0,
  }));
}

/**
 * Lists all images in a specific run subfolder.
 * @param folderId  Drive folder ID (from listRunFolders)
 */
export async function listPhotos(folderId: string): Promise<DrivePhoto[]> {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields:
      'files(id,name,mimeType,createdTime,webViewLink,webContentLink,thumbnailLink,imageMediaMetadata)',
    pageSize: 500,
    orderBy: 'createdTime asc',
  });

  return (res.data.files ?? []) as DrivePhoto[];
}

/**
 * Downloads the binary content of a Drive file. Returns a Buffer.
 */
export async function downloadFile(fileId: string): Promise<Buffer> {
  const drive = getDrive();
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data as ArrayBuffer);
}
