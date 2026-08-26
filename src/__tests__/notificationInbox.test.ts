import { describe, expect, it } from 'vitest';
import { shapeInboxItem, aggregate, type RawItem } from '@/lib/notifications/inbox';

describe('shapeInboxItem', () => {
  const since = '2026-01-01T00:00:00.000Z';

  it('maps a full row correctly, including actor fields', () => {
    const item = shapeInboxItem({
      id: 'n1', kind: 'like', title_he: 'כותרת', body_he: 'תוכן',
      url: '/dashboard/feed', last_sent_at: '2026-01-02T00:00:00.000Z',
      actor: { name: 'Alice', avatar_url: 'https://x/a.png' },
    }, since);
    expect(item).toEqual({
      id: 'n1', kind: 'like', title: 'כותרת', body: 'תוכן',
      url: '/dashboard/feed', sentAt: '2026-01-02T00:00:00.000Z', unread: true,
      actorName: 'Alice', actorAvatarUrl: 'https://x/a.png',
    });
  });

  it('falls back actor fields to null when absent', () => {
    const item = shapeInboxItem({
      id: 'n1', kind: 'system', title_he: 't', body_he: 'b', url: '/x', last_sent_at: since,
    }, since);
    expect(item.actorName).toBeNull();
    expect(item.actorAvatarUrl).toBeNull();
  });

  it('a `#`-prefixed internal url (e.g. a ledger sentinel) falls back to /dashboard', () => {
    const item = shapeInboxItem({
      id: 'n1', kind: 'system', title_he: 't', body_he: 'b', url: '#ledger:workout-123', last_sent_at: since,
    }, since);
    expect(item.url).toBe('/dashboard');
  });

  it('a null url also falls back to /dashboard', () => {
    const item = shapeInboxItem({
      id: 'n1', kind: 'system', title_he: 't', body_he: 'b', url: null, last_sent_at: since,
    }, since);
    expect(item.url).toBe('/dashboard');
  });

  it('unread is true only when last_sent_at is strictly after `since`', () => {
    const base = { id: 'n1', kind: 'system', title_he: 't', body_he: 'b', url: '/x' };
    expect(shapeInboxItem({ ...base, last_sent_at: '2026-01-01T00:00:00.001Z' }, since).unread).toBe(true);
    expect(shapeInboxItem({ ...base, last_sent_at: since }, since).unread).toBe(false);
    expect(shapeInboxItem({ ...base, last_sent_at: '2025-12-31T00:00:00.000Z' }, since).unread).toBe(false);
  });

  it('unread is false when last_sent_at is null', () => {
    const item = shapeInboxItem({ id: 'n1', kind: 'system', title_he: 't', body_he: 'b', url: '/x', last_sent_at: null }, since);
    expect(item.unread).toBe(false);
    expect(item.sentAt).toBe('');
  });
});

describe('aggregate', () => {
  function item(overrides: Partial<RawItem>): RawItem {
    return {
      id: overrides.id || 'x', kind: 'like', title: 't', body: 'b', url: '/feed/1',
      sentAt: '2026-01-01T00:00:00Z', unread: false, actorName: 'Alice', actorAvatarUrl: null,
      ...overrides,
    };
  }

  it('passes through a single groupable item unchanged', () => {
    const result = aggregate([item({ id: '1' })]);
    expect(result).toEqual([item({ id: '1' })]);
  });

  it('never merges non-groupable kinds, even if adjacent with the same url', () => {
    const items = [
      item({ id: '1', kind: 'comment' }),
      item({ id: '2', kind: 'comment' }),
    ];
    expect(aggregate(items)).toHaveLength(2);
  });

  it('merges two adjacent likes on the same url into one "and 1 other" row', () => {
    const items = [item({ id: '1' }), item({ id: '2' })];
    const result = aggregate(items);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1'); // keeps the first (most recent) row's id/timestamp
    expect(result[0].title).toContain('אהבו את הפוסט שלך');
    expect(result[0].title).toContain('ועוד אחד');
  });

  it('merges 3+ adjacent likes into "and N others"', () => {
    const items = [item({ id: '1' }), item({ id: '2' }), item({ id: '3' })];
    const result = aggregate(items);
    expect(result).toHaveLength(1);
    expect(result[0].title).toContain('ו2 אחרים');
  });

  it('does NOT merge across a different url, even for the same groupable kind', () => {
    const items = [
      item({ id: '1', url: '/feed/1' }),
      item({ id: '2', url: '/feed/2' }),
    ];
    expect(aggregate(items)).toHaveLength(2);
  });

  it('does NOT merge non-adjacent same-kind+url items separated by something else', () => {
    const items = [
      item({ id: '1', url: '/feed/1' }),
      item({ id: '2', kind: 'comment' }),
      item({ id: '3', url: '/feed/1' }),
    ];
    const result = aggregate(items);
    expect(result).toHaveLength(3);
  });

  it('merges likes and follows independently within the same list', () => {
    const items = [
      item({ id: '1', kind: 'like', url: '/feed/1' }),
      item({ id: '2', kind: 'like', url: '/feed/1' }),
      item({ id: '3', kind: 'follow', url: '/profile' }),
      item({ id: '4', kind: 'follow', url: '/profile' }),
    ];
    const result = aggregate(items);
    expect(result).toHaveLength(2);
    expect(result[0].title).toContain('אהבו');
    expect(result[1].title).toContain('התחילו לעקוב');
  });

  it('falls back to a generic actor name when actorName is null', () => {
    const items = [item({ id: '1', actorName: null }), item({ id: '2', actorName: null })];
    const result = aggregate(items);
    expect(result[0].title).toContain('מישהו');
  });

  it('returns an empty array for an empty input', () => {
    expect(aggregate([])).toEqual([]);
  });
});
