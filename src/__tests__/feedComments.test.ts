import { describe, expect, it } from 'vitest';
import {
  buildCommentPreviewIndex,
  projectComment,
  validateCommentBody,
  MAX_COMMENT_LENGTH,
} from '@/lib/feed/comments';

describe('projectComment', () => {
  const row = {
    id: 'c1', feed_item_id: 'item-1', athlete_id: 'author-1', body: 'Nice run!', created_at: '2026-01-01T00:00:00Z',
    athletes: { id: 'author-1', name: 'Alice', avatar_url: 'https://x/a.png' },
  };

  it('projects the comment shape with author info', () => {
    expect(projectComment(row, 'author-1', false)).toEqual({
      id: 'c1', itemId: 'item-1', body: 'Nice run!', createdAt: '2026-01-01T00:00:00Z',
      author: { athleteId: 'author-1', name: 'Alice', avatarUrl: 'https://x/a.png' },
      canDelete: true,
    });
  });

  it('the author can delete their own comment even as a non-staff viewer', () => {
    expect(projectComment(row, 'author-1', false).canDelete).toBe(true);
  });

  it('a different non-staff athlete cannot delete someone else\'s comment', () => {
    expect(projectComment(row, 'other-athlete', false).canDelete).toBe(false);
  });

  it('staff can delete any comment, including one not their own', () => {
    expect(projectComment(row, 'other-athlete', true).canDelete).toBe(true);
  });

  it('falls back the author name to "Unknown" when the joined athlete row is missing', () => {
    const orphaned = { ...row, athletes: null };
    expect(projectComment(orphaned, 'author-1', false).author.name).toBe('Unknown');
  });
});

describe('validateCommentBody', () => {
  it('accepts a normal comment, trimmed', () => {
    const result = validateCommentBody('  Great job!  ');
    expect(result).toEqual({ ok: true, body: 'Great job!' });
  });

  it('rejects an empty string', () => {
    expect(validateCommentBody('')).toEqual({ ok: false, error: 'Comment cannot be empty' });
  });

  it('rejects whitespace-only input as empty', () => {
    expect(validateCommentBody('   ')).toEqual({ ok: false, error: 'Comment cannot be empty' });
  });

  it('rejects a non-string value the same as empty', () => {
    expect(validateCommentBody(null)).toEqual({ ok: false, error: 'Comment cannot be empty' });
    expect(validateCommentBody(42)).toEqual({ ok: false, error: 'Comment cannot be empty' });
  });

  it('accepts a comment exactly at the length limit', () => {
    const body = 'a'.repeat(MAX_COMMENT_LENGTH);
    expect(validateCommentBody(body)).toEqual({ ok: true, body });
  });

  it('rejects a comment one character over the length limit', () => {
    const body = 'a'.repeat(MAX_COMMENT_LENGTH + 1);
    const result = validateCommentBody(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(MAX_COMMENT_LENGTH));
  });
});

// The feed card's inline comment preview. The query behind it asks for the
// page's comments newest-first (so a long thread needn't be read in full) and
// this is what turns that flat list into per-item, conversation-ordered tails.
describe('buildCommentPreviewIndex', () => {
  const row = (id: string, itemId: string, body: string, athleteId = 'author-1') => ({
    id, feed_item_id: itemId, athlete_id: athleteId, body,
    created_at: `2026-01-01T00:00:0${id.slice(-1)}Z`,
    athletes: { id: athleteId, name: 'Alice', avatar_url: null },
  });

  it('buckets comments by feed item', () => {
    const index = buildCommentPreviewIndex(
      [row('c1', 'item-1', 'a'), row('c2', 'item-2', 'b')],
      'viewer', false, 2,
    );
    expect([...index.keys()].sort()).toEqual(['item-1', 'item-2']);
    expect(index.get('item-1')!.map(c => c.body)).toEqual(['a']);
  });

  it('keeps only the newest `previewCap` comments per item', () => {
    // Input is newest-first, so the first two rows are the ones to keep.
    const index = buildCommentPreviewIndex(
      [row('c4', 'item-1', 'newest'), row('c3', 'item-1', 'middle'), row('c1', 'item-1', 'oldest')],
      'viewer', false, 2,
    );
    expect(index.get('item-1')!.map(c => c.body)).toEqual(['middle', 'newest']);
  });

  it('flips each bucket back to oldest-first — a preview has to read as a conversation', () => {
    const index = buildCommentPreviewIndex(
      [row('c2', 'item-1', 'second'), row('c1', 'item-1', 'first')],
      'viewer', false, 2,
    );
    expect(index.get('item-1')!.map(c => c.body)).toEqual(['first', 'second']);
  });

  it('carries canDelete through, so the preview agrees with the full thread', () => {
    const index = buildCommentPreviewIndex([row('c1', 'item-1', 'a', 'me')], 'me', false, 2);
    expect(index.get('item-1')![0].canDelete).toBe(true);

    const asOther = buildCommentPreviewIndex([row('c1', 'item-1', 'a', 'me')], 'someone-else', false, 2);
    expect(asOther.get('item-1')![0].canDelete).toBe(false);
  });

  it('returns an empty map for no comments (items then fall back to [])', () => {
    expect(buildCommentPreviewIndex([], 'viewer', false, 2).size).toBe(0);
  });

  it('a cap below 1 yields nothing rather than one comment per item', () => {
    expect(buildCommentPreviewIndex([row('c1', 'item-1', 'a')], 'viewer', false, 0).size).toBe(0);
  });
});
