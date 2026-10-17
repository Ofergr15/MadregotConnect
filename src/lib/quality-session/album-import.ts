// Pull photos straight from the album link (#106, Ofer 2026-10-17: "it takes a link
// and pulls the photos into the feed"). Two kinds of link are readable without a
// Google login, and only when they are shared with "anyone with the link":
//
//  - a Google Drive FOLDER: drive.google.com/embeddedfolderview?id=… is Drive's
//    own public grid of the folder, one entry per file (`id="entry-<fileId>"`), and
//    lh3.googleusercontent.com/d/<fileId>=w1600 is that file as an image.
//  - a Google Photos shared ALBUM (photos.app.goo.gl/… → photos.google.com/share/…):
//    the page carries every photo as lh3.googleusercontent.com/pw/… URLs.
//
// Pure parsing here, so it can be pinned in tests; the fetching is the route's.
// Only Google hosts are ever fetched (ALBUM_HOSTS / IMAGE_HOSTS) — the link is
// user input, and the server must not become a way to fetch anything else.

export type AlbumLink =
  | { kind: 'drive'; folderId: string }
  | { kind: 'gphotos'; url: string };

export const ALBUM_HOSTS = ['drive.google.com', 'photos.google.com', 'photos.app.goo.gl'];
export const IMAGE_HOSTS = ['lh3.googleusercontent.com', 'lh3.google.com', 'drive.google.com'];

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

export function parseAlbumLink(link: string): AlbumLink | null {
  let u: URL;
  try { u = new URL(link); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.hostname === 'drive.google.com') {
    const m = u.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/);
    const id = m?.[1] ?? u.searchParams.get('id');
    return id && DRIVE_ID.test(id) ? { kind: 'drive', folderId: id } : null;
  }
  if (u.hostname === 'photos.app.goo.gl' || (u.hostname === 'photos.google.com' && u.pathname.startsWith('/share/'))) {
    return { kind: 'gphotos', url: u.toString() };
  }
  return null;
}

export const driveFolderGridUrl = (folderId: string) =>
  `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#grid`;

const IMAGE_NAME = /\.(jpe?g|png|heic|heif|webp)$/i;

/**
 * The image files in Drive's public folder grid, in the folder's order. A file is
 * kept when its title looks like a photo; an entry with no readable title is kept
 * too (the download decides) — a folder of videos then simply yields nothing.
 */
export function driveFolderImages(html: string, max = 12): string[] {
  const out: string[] = [];
  const entry = /id="entry-([A-Za-z0-9_-]{10,})"([\s\S]*?)(?=id="entry-|$)/g;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(html)) && out.length < max) {
    const title = m[2].match(/class="flip-entry-title"[^>]*>([^<]*)</)?.[1]?.trim();
    if (title && !IMAGE_NAME.test(title)) continue;
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out.map(id => `https://lh3.googleusercontent.com/d/${id}=w1600`);
}

/**
 * The photos on a Google Photos shared-album page, deduplicated, at 1600 px. The
 * page repeats each photo's base URL with different size suffixes, and also carries
 * the owner's small avatar (an /a/ URL, which the /pw/ pattern does not match).
 */
export function googlePhotosImages(html: string, max = 12): string[] {
  const seen = new Set<string>();
  for (const m of html.matchAll(/https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]{30,}/g)) {
    seen.add(m[0]);
    if (seen.size >= max) break;
  }
  return [...seen].map(u => `${u}=w1600-h1600`);
}

export function isAllowedHost(url: string, hosts: string[]): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && hosts.includes(u.hostname);
  } catch {
    return false;
  }
}
