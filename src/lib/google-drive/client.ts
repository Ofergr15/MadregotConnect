/**
 * Google Drive client for importing run photos.
 *
 * Authentication: service account JWT (not OAuth). The service account email
 * needs read access to the Drive folder — share the folder with it once in Drive.
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   (the RSA key from the JSON key file)
 *   GOOGLE_DRIVE_FOLDER_ID               (already set)
 */

import { google } from 'googleapis';

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID!;

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

export interface DrivePhoto {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string; // ISO string
  webViewLink: string;
  webContentLink?: string;
  thumbnailLink?: string;
  imageMediaMetadata?: { width: number; height: number };
}

/**
 * Returns the set of distinct dates (YYYY-MM-DD) of images in the folder,
 * derived from each file's createdTime. Used by the Import tab date picker.
 */
export async function listPhotoDates(): Promise<string[]> {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: 'files(id,createdTime)',
    pageSize: 1000,
    orderBy: 'createdTime desc',
  });

  const dates = new Set<string>();
  for (const f of res.data.files ?? []) {
    if (f.createdTime) {
      dates.add(f.createdTime.slice(0, 10)); // YYYY-MM-DD
    }
  }
  return Array.from(dates).sort().reverse();
}

/**
 * Lists all images in the folder whose createdTime falls on the given date
 * (YYYY-MM-DD, UTC-based comparison).
 */
export async function listPhotos(date: string): Promise<DrivePhoto[]> {
  const drive = getDrive();
  // Drive's query syntax uses RFC 3339
  const start = `${date}T00:00:00Z`;
  const end = `${date}T23:59:59Z`;

  const res = await drive.files.list({
    q: [
      `'${FOLDER_ID}' in parents`,
      `mimeType contains 'image/'`,
      `trashed = false`,
      `createdTime >= '${start}'`,
      `createdTime <= '${end}'`,
    ].join(' and '),
    fields:
      'files(id,name,mimeType,createdTime,webViewLink,webContentLink,thumbnailLink,imageMediaMetadata)',
    pageSize: 200,
    orderBy: 'createdTime asc',
  });

  return (res.data.files ?? []) as DrivePhoto[];
}

/**
 * Downloads the binary content of a Drive file. Returns a Buffer suitable for
 * passing to Rekognition or sharp.
 */
export async function downloadFile(fileId: string): Promise<Buffer> {
  const drive = getDrive();
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data as ArrayBuffer);
}
