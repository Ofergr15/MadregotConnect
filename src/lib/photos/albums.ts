// Photo gallery albums (task 183): the club's Drive photo folders grouped into one album per
// club week or per event, newest first, paged. Pure — the Drive listing, the events read and the
// signing live in the routes.
//
// A Drive folder is one session's photos and carries the session's date. Grouping:
// - week  — by PLAN week (Sunday start, planWeekStartOf), because a photo folder is a club
//           session and the club's sessions are planned Sun–Sat. Not the activity week.
// - event — by the club event whose [date, end_date] contains the folder's date. A folder on a day
//           with no event is in no event album (it is still in its week album).
import { planWeekStartOf } from '@/lib/utils';

export type AlbumKind = 'week' | 'event';

export interface AlbumFolder { id: string; date: string; title: string | null; name: string; count: number; covers: string[] }
export interface ClubEvent { id: string; name: string; date: string; end_date: string | null }

export interface Album {
  /** `week:YYYY-MM-DD` (the Sunday) or `event:<eventId>`. Stable, so a client can deep-link. */
  key: string;
  kind: AlbumKind;
  title: string;
  /** Inclusive date span of the album's folders. */
  from: string;
  to: string;
  /** Sort anchor (newest first): the week start, or the event's first day. */
  anchor: string;
  folderIds: string[];
  count: number;
  /** Raw Drive ids of the first few covers; the route turns them into signed thumbnails. */
  coverIds: string[];
  eventId?: string;
}

export const ALBUM_COVERS = 3;
export const ALBUMS_PAGE_DEFAULT = 12;
export const ALBUMS_PAGE_MAX = 30;
export const ALBUM_PHOTOS_PAGE_DEFAULT = 60;
export const ALBUM_PHOTOS_PAGE_MAX = 120;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function finish(key: string, kind: AlbumKind, title: string, anchor: string, folders: AlbumFolder[], eventId?: string): Album {
  const sorted = [...folders].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return {
    key, kind, title, anchor,
    from: sorted[sorted.length - 1].date,
    to: sorted[0].date,
    folderIds: sorted.map((f) => f.id),
    count: sorted.reduce((s, f) => s + (f.count || 0), 0),
    coverIds: sorted.flatMap((f) => f.covers).slice(0, ALBUM_COVERS),
    ...(eventId ? { eventId } : {}),
  };
}

/** One album per plan week that has photos. Folders without a valid date are left out. */
export function weekAlbums(folders: AlbumFolder[]): Album[] {
  const by = new Map<string, AlbumFolder[]>();
  for (const f of folders) {
    if (!ISO.test(f.date)) continue;
    const w = planWeekStartOf(f.date);
    by.set(w, [...(by.get(w) ?? []), f]);
  }
  return [...by.entries()].map(([w, fs]) => finish(`week:${w}`, 'week', w, w, fs))
    .sort((a, b) => b.anchor.localeCompare(a.anchor));
}

/** One album per event that has at least one photo folder inside its dates. */
export function eventAlbums(folders: AlbumFolder[], events: ClubEvent[]): Album[] {
  const out: Album[] = [];
  for (const e of events) {
    if (!ISO.test(e.date)) continue;
    const end = e.end_date && ISO.test(e.end_date) && e.end_date >= e.date ? e.end_date : e.date;
    const fs = folders.filter((f) => ISO.test(f.date) && e.date <= f.date && f.date <= end);
    if (fs.length) out.push(finish(`event:${e.id}`, 'event', e.name, e.date, fs, e.id));
  }
  return out.sort((a, b) => b.anchor.localeCompare(a.anchor) || a.key.localeCompare(b.key));
}

export function clampLimit(raw: string | null, def: number, max: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : def;
}

/**
 * Keyset page over albums already sorted newest first. The cursor is the last key the client
 * got; an unknown cursor (album gone since) restarts from the top rather than erroring.
 */
export function pageAlbums(albums: Album[], cursor: string | null, limit: number): { albums: Album[]; nextCursor: string | null } {
  const at = cursor ? albums.findIndex((a) => a.key === cursor) : -1;
  const start = at >= 0 ? at + 1 : 0;
  const page = albums.slice(start, start + limit);
  const more = start + limit < albums.length;
  return { albums: page, nextCursor: more && page.length ? page[page.length - 1].key : null };
}

/** Parses `week:YYYY-MM-DD` / `event:<id>`. Null for anything else. */
export function parseAlbumKey(raw: string | null): { kind: AlbumKind; value: string } | null {
  const m = /^(week|event):([A-Za-z0-9-]{1,64})$/.exec(raw || '');
  if (!m) return null;
  if (m[1] === 'week' && (!ISO.test(m[2]) || planWeekStartOf(m[2]) !== m[2])) return null;
  return { kind: m[1] as AlbumKind, value: m[2] };
}

/** Offset page (photos inside one album are a fixed, ordered list). */
export function pageOffset<T>(items: T[], rawOffset: string | null, limit: number): { items: T[]; nextOffset: number | null } {
  const n = Number(rawOffset);
  const offset = Number.isInteger(n) && n > 0 ? n : 0;
  const items_ = items.slice(offset, offset + limit);
  return { items: items_, nextOffset: offset + limit < items.length ? offset + limit : null };
}
