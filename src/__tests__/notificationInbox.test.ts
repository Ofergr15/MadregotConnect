import { describe, expect, it } from 'vitest';
import {
  shapeInboxItem,
  aggregate,
  rowActionTargets,
  applyRowActions,
  rsvpKey,
  type RawItem,
} from '@/lib/notifications/inbox';

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

// The inbox's interactive rows (kudos, RSVP) used to each load their own state
// on mount — ~45 extra requests on a normal 50-row page. These cover the bulk
// replacement: which rows need looking up, and how the answers are attached.
describe('row actions', () => {
  const row = (over: Partial<RawItem> = {}): RawItem => ({
    id: 'n1', kind: 'kudos_activity', title: 't', body: 'b',
    url: '/feed?activity=act-1', sentAt: '2026-01-02T00:00:00.000Z', unread: false,
    actorName: null, actorAvatarUrl: null, ...over,
  });

  describe('rowActionTargets', () => {
    it('collects kudos activity ids and RSVP weeks', () => {
      const targets = rowActionTargets([
        row({ id: '1', url: '/feed?activity=act-1' }),
        row({ id: '2', kind: 'training_before', url: '/dashboard?rsvp=2026-01-04:2' }),
      ]);
      expect(targets).toEqual({ activityIds: ['act-1'], weekStarts: ['2026-01-04'] });
    });

    it('dedupes — a burst about one activity or one week is still one lookup', () => {
      const targets = rowActionTargets([
        row({ id: '1', url: '/feed?activity=act-1' }),
        row({ id: '2', url: '/feed?activity=act-1' }),
        row({ id: '3', kind: 'training_before', url: '/dashboard?rsvp=2026-01-04:1' }),
        row({ id: '4', kind: 'training_before', url: '/dashboard?rsvp=2026-01-04:3' }),
      ]);
      expect(targets.activityIds).toEqual(['act-1']);
      expect(targets.weekStarts).toEqual(['2026-01-04']);
    });

    it('ignores rows with no inline action, so a plain inbox queries nothing', () => {
      const targets = rowActionTargets([
        row({ id: '1', kind: 'like', url: '/feed/1' }),
        row({ id: '2', kind: 'survey', url: '/dashboard/surveys' }),
      ]);
      expect(targets).toEqual({ activityIds: [], weekStarts: [] });
    });

    it('accepts the legacy ?kudos= spelling still sitting in old rows', () => {
      expect(rowActionTargets([row({ url: '/dashboard/activities?kudos=old-1' })]).activityIds).toEqual(['old-1']);
    });
  });

  describe('applyRowActions', () => {
    it('marks a kudos row given only when this athlete is in the lookup', () => {
      const result = applyRowActions(
        [row({ id: '1', url: '/feed?activity=act-1' }), row({ id: '2', url: '/feed?activity=act-2' })],
        { kudosGiven: new Set(['act-1']), rsvpByKey: new Map() },
      );
      expect(result[0].kudosGiven).toBe(true);
      expect(result[1].kudosGiven).toBe(false);
    });

    it('attaches the RSVP answer for the matching week AND day', () => {
      const items = [
        row({ id: '1', kind: 'training_before', url: '/dashboard?rsvp=2026-01-04:2' }),
        row({ id: '2', kind: 'training_before', url: '/dashboard?rsvp=2026-01-04:4' }),
      ];
      const result = applyRowActions(items, {
        kudosGiven: new Set(),
        rsvpByKey: new Map([[rsvpKey('2026-01-04', 2), true], [rsvpKey('2026-01-04', 4), false]]),
      });
      expect(result[0].rsvpAttending).toBe(true);
      expect(result[1].rsvpAttending).toBe(false);
    });

    it('an unanswered practice is null, not false — "no answer" is not "not coming"', () => {
      const result = applyRowActions(
        [row({ kind: 'training_before', url: '/dashboard?rsvp=2026-01-04:2' })],
        { kudosGiven: new Set(), rsvpByKey: new Map() },
      );
      expect(result[0].rsvpAttending).toBeNull();
    });

    // The failure mode this guards: annotating a kudos row `false` because the
    // query never ran would leave the button wrong AND stop it from asking, and
    // a second tap on a wrongly-un-given button DELETEs a real reaction.
    it('leaves fields absent when a lookup is missing, so the row still asks for itself', () => {
      const items = [
        row({ id: '1', url: '/feed?activity=act-1' }),
        row({ id: '2', kind: 'training_before', url: '/dashboard?rsvp=2026-01-04:2' }),
      ];
      const result = applyRowActions(items, { kudosGiven: null, rsvpByKey: null });
      expect(result[0].kudosGiven).toBeUndefined();
      expect(result[1].rsvpAttending).toBeUndefined();
      expect(result).toEqual(items);
    });

    it('annotates one side even when the other lookup failed', () => {
      const items = [
        row({ id: '1', url: '/feed?activity=act-1' }),
        row({ id: '2', kind: 'training_before', url: '/dashboard?rsvp=2026-01-04:2' }),
      ];
      const result = applyRowActions(items, { kudosGiven: new Set(['act-1']), rsvpByKey: null });
      expect(result[0].kudosGiven).toBe(true);
      expect(result[1].rsvpAttending).toBeUndefined();
    });

    it('leaves non-interactive rows untouched', () => {
      const items = [row({ id: '1', kind: 'like', url: '/feed/1' })];
      const result = applyRowActions(items, { kudosGiven: new Set(['act-1']), rsvpByKey: new Map() });
      expect(result[0]).toEqual(items[0]);
    });
  });
});
