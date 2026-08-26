import { describe, expect, it } from 'vitest';
import { clampFeedLimit, parseFeedCursor, DEFAULT_FEED_LIMIT, MAX_FEED_LIMIT } from '@/lib/feed/pagination';

describe('clampFeedLimit', () => {
  it('returns the default when no limit is given', () => {
    expect(clampFeedLimit(null)).toBe(DEFAULT_FEED_LIMIT);
  });

  it('passes through a valid in-range value', () => {
    expect(clampFeedLimit('10')).toBe(10);
  });

  it('caps at MAX_FEED_LIMIT for anything larger', () => {
    expect(clampFeedLimit('9999')).toBe(MAX_FEED_LIMIT);
  });

  it('floors at 1 for zero or negative values', () => {
    expect(clampFeedLimit('0')).toBe(DEFAULT_FEED_LIMIT); // 0 is falsy, falls back to default (matches original `|| DEFAULT_LIMIT` behavior)
    expect(clampFeedLimit('-5')).toBe(1);
  });

  it('falls back to the default for unparseable input', () => {
    expect(clampFeedLimit('not-a-number')).toBe(DEFAULT_FEED_LIMIT);
    expect(clampFeedLimit('')).toBe(DEFAULT_FEED_LIMIT);
  });
});

describe('parseFeedCursor', () => {
  it('returns null for no cursor', () => {
    expect(parseFeedCursor(null)).toBeNull();
  });

  it('splits a well-formed "time,id" cursor', () => {
    expect(parseFeedCursor('2026-01-01T00:00:00.000Z,item-42')).toEqual({
      time: '2026-01-01T00:00:00.000Z',
      id: 'item-42',
    });
  });

  it('treats a cursor with no comma as time-only, empty id', () => {
    expect(parseFeedCursor('2026-01-01T00:00:00.000Z')).toEqual({
      time: '2026-01-01T00:00:00.000Z',
      id: '',
    });
  });

  it('throws for a cursor whose time part is not a real date', () => {
    expect(() => parseFeedCursor('not-a-date,item-1')).toThrow('Invalid cursor');
  });
});
