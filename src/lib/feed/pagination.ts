export const DEFAULT_FEED_LIMIT = 20;
export const MAX_FEED_LIMIT = 40;

/** Clamps the client-requested page size into [1, MAX_FEED_LIMIT], falling back to the default for anything unparseable (NaN) or non-positive (0, negative). */
export function clampFeedLimit(raw: string | null): number {
  const parsed = parseInt(raw || String(DEFAULT_FEED_LIMIT), 10) || DEFAULT_FEED_LIMIT;
  return Math.min(MAX_FEED_LIMIT, Math.max(1, parsed));
}

export type FeedCursor = { time: string; id: string } | null;

/** An ISO-8601 instant as Postgres or `Date#toISOString` writes it: up to microseconds, `Z` or a `±hh:mm` offset. */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds the `nextCursor` for the last row of a page: `"<occurred_at>,<id>"`.
 *
 * The time is written back TEXTUALLY, never through `new Date()`: Postgres keeps
 * microseconds and a JS Date keeps milliseconds, so a round trip would move the
 * boundary back by up to 999 µs and the next page would repeat the row the cursor
 * names. The one rewrite is a UTC `+00:00` → `Z`, which is the same instant and
 * takes the `+` out of the cursor — a client that puts the cursor in a URL without
 * encoding it turns `+` into a space, and the next page would 400.
 */
export function encodeFeedCursor(row: { occurred_at: string; id: string }): string {
  const time = row.occurred_at.replace(/\+00(?::?00)?$/, 'Z');
  return `${time},${row.id}`;
}

/**
 * Parses the "<iso timestamp>,<uuid>" keyset cursor. Returns `null` for no
 * cursor at all, or throws for anything else that isn't exactly that shape —
 * the route turns that into a 400 rather than silently querying with an
 * invalid boundary.
 *
 * Strict on purpose: both parts are interpolated into a PostgREST `or=(…)`
 * filter, so a cursor carrying `)` or `,` could otherwise add conditions of its
 * own. A `+` offset that arrived as a space (an unencoded `+` in a query string)
 * is put back. A cursor with no id (pre-keyset clients) is still accepted.
 */
export function parseFeedCursor(raw: string | null): FeedCursor {
  if (!raw) return null;
  const idx = raw.lastIndexOf(',');
  let time = (idx === -1 ? raw : raw.slice(0, idx)).trim();
  const id = idx === -1 ? '' : raw.slice(idx + 1).trim();
  time = time.replace(/ (\d{2}(?::?\d{2})?)$/, '+$1');
  if (!ISO_INSTANT_RE.test(time) || !Number.isFinite(Date.parse(time))) {
    throw new Error('Invalid cursor');
  }
  if (id !== '' && !UUID_RE.test(id)) throw new Error('Invalid cursor');
  return { time, id };
}

/**
 * The PostgREST `or` filter for "strictly after the cursor" in the feed's
 * (occurred_at DESC, id DESC) order, or `null` for a time-only cursor (the
 * caller uses `lt` on occurred_at for that one).
 */
export function feedCursorOrFilter(cursor: NonNullable<FeedCursor>): string | null {
  if (!cursor.id) return null;
  return `occurred_at.lt.${cursor.time},and(occurred_at.eq.${cursor.time},id.lt.${cursor.id})`;
}

/**
 * The same predicate as `feedCursorOrFilter`, in JS — what the DB is asked to do,
 * for tests and for any in-memory pager. Compares instants (not strings) for the
 * time, and the id the way Postgres orders uuids (lexically on the lower-case hex).
 */
export function isAfterFeedCursor(row: { occurred_at: string; id: string }, cursor: NonNullable<FeedCursor>): boolean {
  const a = instantKey(row.occurred_at);
  const b = instantKey(cursor.time);
  if (a !== b) return a < b;
  if (!cursor.id) return false;
  return row.id.toLowerCase() < cursor.id.toLowerCase();
}

/** Sortable key for an ISO instant at microsecond precision (Date.parse alone drops µs). */
function instantKey(iso: string): string {
  const m = /\.(\d{1,6})/.exec(iso);
  const micros = m ? m[1].padEnd(6, '0').slice(3) : '000';
  const ms = Date.parse(iso);
  return `${String(ms).padStart(16, '0')}${micros}`;
}

/**
 * Appends a page to what is already on screen, dropping any item whose id is
 * already there. Keyset paging itself never repeats a row, but the screen can
 * still see one twice: a refreshed first page swapped in under an older cursor,
 * or a run whose occurred_at moved when its Garmin twin replaced the Strava copy.
 */
export function appendFeedPage<T extends { id: string }>(prev: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(prev.map((i) => i.id));
  const out = prev.slice();
  for (const item of page) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
