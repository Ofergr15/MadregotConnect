import { driveWriter } from '@/lib/google-drive/writer';
import { refreshLibraryFolders } from './drive-browse';
import { FOLDER_KINDS, writeTags, type FolderKind } from './folder-kind';

// Staff edits to a photo folder (the long press's "לצוות" items, and the folder's kind and
// tags chosen when it is made). Written onto the Drive folder's appProperties, the place
// lib/photos/drive-browse already reads it from; nothing is ever deleted from Drive here:
// the app does not remove photos, by design (Ofer, 10-20).

export interface FolderMetaPatch {
  kind?: FolderKind;
  tags?: string[];
  /** Shown instead of the cleaned-up Drive name; '' goes back to the name. */
  title?: string;
  pinned?: boolean;
  /** A photo id from the folder, shown first on its card. */
  cover?: string | null;
}

export async function setFolderMeta(folderId: string, patch: FolderMetaPatch): Promise<void> {
  const drive = driveWriter();
  if (!drive) throw new Error('Drive not configured');
  if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) throw new Error('bad folder id');
  const appProperties: Record<string, string | null> = {};
  if (patch.kind && (FOLDER_KINDS as readonly string[]).includes(patch.kind)) appProperties.madregotType = patch.kind;
  if (patch.tags) appProperties.madregotTags = writeTags(patch.tags) || null;
  if (patch.title !== undefined) appProperties.madregotTitle = patch.title.trim().slice(0, 60) || null;
  if (patch.pinned !== undefined) appProperties.madregotPinned = patch.pinned ? '1' : '0';
  if (patch.cover !== undefined) appProperties.madregotCover = patch.cover && /^[A-Za-z0-9_-]{10,}$/.test(patch.cover) ? patch.cover : null;
  if (!Object.keys(appProperties).length) return;
  // A null value removes the key on Drive's side; the typings only admit strings.
  await drive.files.update({ fileId: folderId, requestBody: { appProperties: appProperties as Record<string, string> }, supportsAllDrives: true, fields: 'id' });
  // At once (the admin is looking at the change): the folders' own records again over the
  // stored listing — one Drive call, never the full walk (lib/photos/drive-browse).
  await refreshLibraryFolders().catch((err) => console.warn('[photos] listing refresh failed', err));
}
