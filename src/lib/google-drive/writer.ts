import { google, type drive_v3 } from 'googleapis';

// Drive, writable — for the quality session's photo folders (#106 follow-up,
// Ofer 2026-10-18: "the evening before each quality day, a folder for its photos").
//
// The service account `madregot-photos@madregot-photos.iam.gserviceaccount.com`
// is an Editor on ONE folder of the club's Drive (SESSION_PHOTOS_DRIVE_FOLDER_ID,
// "Madregot_After_2KM") and sees nothing else. Server only; the key lives in
// Vercel's env, never in the repo. Without the env everything here is a no-op.

export function driveWriter(): drive_v3.Drive | null {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key || !process.env.SESSION_PHOTOS_DRIVE_FOLDER_ID) return null;
  return google.drive({
    version: 'v3',
    auth: new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/drive'] }),
  });
}

export interface DayFolder { id: string; link: string }

/**
 * The day's folder under the club's photos folder, created once. Found again by
 * its appProperty (the date), not by its name, so renaming it in Drive changes
 * nothing. Anyone with the link may add to it: the photographer uploads from
 * their phone without being invited first.
 */
export async function ensureDayFolder(drive: drive_v3.Drive, date: string, name: string): Promise<DayFolder> {
  const root = process.env.SESSION_PHOTOS_DRIVE_FOLDER_ID!;
  const found = await drive.files.list({
    q: `'${root}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='madregotSessionDate' and value='${date}' }`,
    fields: 'files(id,webViewLink)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const hit = found.data.files?.[0];
  if (hit?.id) return { id: hit.id, link: hit.webViewLink || `https://drive.google.com/drive/folders/${hit.id}` };

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [root],
      appProperties: { madregotSessionDate: date },
    },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });
  const id = created.data.id!;
  await drive.permissions.create({ fileId: id, requestBody: { type: 'anyone', role: 'writer' }, supportsAllDrives: true });
  return { id, link: created.data.webViewLink || `https://drive.google.com/drive/folders/${id}` };
}
