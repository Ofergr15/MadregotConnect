import { describe, expect, it } from 'vitest';
import { buildLikeIndex } from '@/lib/feed/likes';

function likeRow(itemId: string, athleteId: string, name = 'Someone') {
  return { feed_item_id: itemId, created_at: '2026-01-01T00:00:00Z', athletes: { id: athleteId, name, avatar_url: null } };
}

describe('buildLikeIndex', () => {
  it('marks an item as liked-by-me when the viewer is among its likers', () => {
    const { likedItemIds } = buildLikeIndex([likeRow('item-1', 'viewer')], 'viewer', 3);
    expect(likedItemIds.has('item-1')).toBe(true);
  });

  it('does not mark an item liked when the viewer never liked it', () => {
    const { likedItemIds } = buildLikeIndex([likeRow('item-1', 'someone-else')], 'viewer', 3);
    expect(likedItemIds.has('item-1')).toBe(false);
  });

  it('a null viewerAthleteId (staff with no athlete row) never matches, even against a like row with a coincidental null-like id', () => {
    const { likedItemIds } = buildLikeIndex([likeRow('item-1', 'someone')], null, 3);
    expect(likedItemIds.size).toBe(0);
  });

  it('caps the preview bucket per item at previewCap, keeping the earliest-seen (newest, since input is presorted) entries', () => {
    const rows = [
      likeRow('item-1', 'a', 'Alice'),
      likeRow('item-1', 'b', 'Bob'),
      likeRow('item-1', 'c', 'Cara'),
      likeRow('item-1', 'd', 'Dana'), // 4th liker, over the cap of 3
    ];
    const { likersByItem } = buildLikeIndex(rows, 'viewer', 3);
    const preview = likersByItem.get('item-1');
    expect(preview).toHaveLength(3);
    expect(preview?.map((l) => l.name)).toEqual(['Alice', 'Bob', 'Cara']);
  });

  it('tracks likers independently per item — a full bucket on one item never affects another', () => {
    const rows = [likeRow('item-1', 'a'), likeRow('item-1', 'b'), likeRow('item-2', 'c')];
    const { likersByItem } = buildLikeIndex(rows, null, 1);
    expect(likersByItem.get('item-1')).toHaveLength(1);
    expect(likersByItem.get('item-2')).toHaveLength(1);
  });

  it('skips a malformed row (no joined athlete) rather than throwing or polluting the index', () => {
    const malformed = { feed_item_id: 'item-1', created_at: '2026-01-01T00:00:00Z', athletes: null };
    const { likedItemIds, likersByItem } = buildLikeIndex([malformed], 'viewer', 3);
    expect(likedItemIds.size).toBe(0);
    expect(likersByItem.size).toBe(0);
  });

  it('an empty input returns empty structures, not undefined/throw', () => {
    const { likedItemIds, likersByItem } = buildLikeIndex([], 'viewer', 3);
    expect(likedItemIds.size).toBe(0);
    expect(likersByItem.size).toBe(0);
  });
});
