import { describe, expect, it } from 'vitest';
import {
  appendFeedPage,
  encodeFeedCursor,
  feedCursorOrFilter,
  isAfterFeedCursor,
  parseFeedCursor,
} from '@/lib/feed/pagination';

/**
 * Task 161 — the feed cursor is stable: walking the feed page by page returns
 * every item exactly once even while new items arrive at the top (new posts),
 * in the middle (a run synced late lands at its start time) or on the very
 * boundary timestamp of the page just read.
 */

type Row = { id: string; occurred_at: string };
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
/** Postgres-shaped: microseconds and a +00:00 offset. */
const pgTime = (ms: number, micros = 0) =>
  new Date(ms).toISOString().replace(/\.(\d{3})Z$/, (_, mmm) => `.${mmm}${String(micros).padStart(3, '0')}+00:00`);

/** What the DB does for one page: order (occurred_at DESC, id DESC), keyset filter, limit + 1. */
function dbPage(table: Row[], cursorRaw: string | null, limit: number) {
  const cursor = parseFeedCursor(cursorRaw);
  const sorted = table
    .filter((r) => !cursor || isAfterFeedCursor(r, cursor))
    .sort((a, b) => (isAfterFeedCursor(a, { time: b.occurred_at, id: b.id }) ? 1 : -1));
  const rows = sorted.slice(0, limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page, nextCursor: rows.length > limit && last ? encodeFeedCursor(last) : null };
}

/** A client walking to the end, optionally mutating the table between pages. */
function walk(table: Row[], limit: number, between?: (pageNo: number) => void, unencodedPlus = false) {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let pageNo = 0; pageNo < 1000; pageNo++) {
    const { items, nextCursor } = dbPage(table, cursor, limit);
    seen.push(...items.map((i) => i.id));
    if (!nextCursor) return seen;
    // Simulates a native client that pastes the cursor into the URL unencoded: `+` arrives as a space.
    cursor = unencodedPlus ? new URLSearchParams(`cursor=${nextCursor}`).get('cursor') : nextCursor;
    between?.(pageNo);
  }
  throw new Error('did not terminate');
}

const T0 = Date.UTC(2026, 10, 20, 6, 0, 0);

describe('stable keyset cursor', () => {
  it('walks every row exactly once, ties on occurred_at broken by id', () => {
    // 50 rows, ten per identical timestamp — offset/time-only paging would skip or repeat here.
    const table: Row[] = Array.from({ length: 50 }, (_, i) => ({ id: uuid(i + 1), occurred_at: pgTime(T0 - Math.floor(i / 10) * 60_000) }));
    const seen = walk(table, 7);
    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50);
  });

  it('new items at the top mid-scroll cause no duplicates and no skips', () => {
    const table: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: uuid(i + 1), occurred_at: pgTime(T0 - i * 60_000) }));
    const original = table.map((r) => r.id);
    let next = 1000;
    const seen = walk(table, 5, () => {
      for (let k = 0; k < 3; k++) table.push({ id: uuid(next++), occurred_at: pgTime(T0 + next * 1000) });
    });
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(original); // the new ones are above the scroll, the old ones all arrive, in order
  });

  it('a row inserted on the exact boundary timestamp is neither repeated nor allowed to shift the rest', () => {
    const table: Row[] = Array.from({ length: 20 }, (_, i) => ({ id: uuid(100 + i), occurred_at: pgTime(T0 - i * 60_000) }));
    const original = table.map((r) => r.id);
    const seen = walk(table, 4, (pageNo) => {
      if (pageNo !== 0) return;
      // Same instant as the last row of page 1 (index 3), lower id → sorts after it, still ahead of the scroll.
      table.push({ id: uuid(1), occurred_at: table[3].occurred_at });
    });
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of original) expect(seen).toContain(id);
    expect(seen).toContain(uuid(1));
  });

  it('a late-synced run below the scroll position is picked up, above it is not repeated', () => {
    const table: Row[] = Array.from({ length: 20 }, (_, i) => ({ id: uuid(i + 1), occurred_at: pgTime(T0 - i * 3_600_000) }));
    const seen = walk(table, 5, (pageNo) => {
      if (pageNo !== 0) return;
      table.push({ id: uuid(500), occurred_at: pgTime(T0 - 15.5 * 3_600_000) }); // below — will be reached
      table.push({ id: uuid(501), occurred_at: pgTime(T0 - 1.5 * 3_600_000) }); // above — already scrolled past
    });
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toContain(uuid(500));
    expect(seen).not.toContain(uuid(501));
    expect(seen).toHaveLength(21);
  });

  it('microsecond timestamps are not rounded into a repeat (two rows 400 µs apart in one ms)', () => {
    const table: Row[] = [
      { id: uuid(9), occurred_at: pgTime(T0, 900) },
      { id: uuid(8), occurred_at: pgTime(T0, 500) },
      { id: uuid(7), occurred_at: pgTime(T0, 100) },
      { id: uuid(6), occurred_at: pgTime(T0 - 1) },
    ];
    const seen = walk(table, 1);
    expect(seen).toEqual([uuid(9), uuid(8), uuid(7), uuid(6)]);
  });

  it('still works when the client sends the cursor unencoded (`+` → space)', () => {
    const table: Row[] = Array.from({ length: 12 }, (_, i) => ({ id: uuid(i + 1), occurred_at: pgTime(T0 - i * 60_000).replace('+00:00', '+02:00') }));
    const seen = walk(table, 5, undefined, true);
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });
});

describe('encodeFeedCursor', () => {
  it('keeps microseconds and writes UTC as Z (no "+" in the cursor)', () => {
    expect(encodeFeedCursor({ occurred_at: '2026-11-20T06:12:33.123456+00:00', id: uuid(1) })).toBe(`2026-11-20T06:12:33.123456Z,${uuid(1)}`);
  });
  it('leaves an already-Z or non-UTC time alone', () => {
    expect(encodeFeedCursor({ occurred_at: '2026-11-20T06:12:33.123Z', id: uuid(1) })).toBe(`2026-11-20T06:12:33.123Z,${uuid(1)}`);
    expect(encodeFeedCursor({ occurred_at: '2026-11-20T08:12:33+02:00', id: uuid(1) })).toBe(`2026-11-20T08:12:33+02:00,${uuid(1)}`);
  });
});

describe('parseFeedCursor — strict, because the parts go into a PostgREST or=() filter', () => {
  it('rejects an id that is not a uuid (filter injection)', () => {
    expect(() => parseFeedCursor(`2026-11-20T06:00:00Z,${uuid(1)}),type.eq.post`)).toThrow('Invalid cursor');
    expect(() => parseFeedCursor('2026-11-20T06:00:00Z,abc')).toThrow('Invalid cursor');
  });
  it('rejects a time with trailing filter syntax', () => {
    expect(() => parseFeedCursor(`2026-11-20T06:00:00Z),id.gt.0,${uuid(1)}`)).toThrow('Invalid cursor');
    expect(() => parseFeedCursor(`Nov 20 2026,${uuid(1)}`)).toThrow('Invalid cursor');
  });
  it('restores a "+" offset that arrived as a space', () => {
    expect(parseFeedCursor(`2026-11-20T08:00:00.5 02:00,${uuid(1)}`)).toEqual({ time: '2026-11-20T08:00:00.5+02:00', id: uuid(1) });
  });
  it('a time-only cursor (pre-keyset clients) has no or-filter', () => {
    expect(feedCursorOrFilter(parseFeedCursor('2026-11-20T06:00:00Z')!)).toBeNull();
  });
});

describe('appendFeedPage', () => {
  it('drops ids already on screen and keeps order', () => {
    const prev = [{ id: 'a' }, { id: 'b' }];
    expect(appendFeedPage(prev, [{ id: 'b' }, { id: 'c' }, { id: 'c' }, { id: 'd' }]).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('does not mutate the previous list', () => {
    const prev = [{ id: 'a' }];
    appendFeedPage(prev, [{ id: 'b' }]);
    expect(prev).toEqual([{ id: 'a' }]);
  });
});
