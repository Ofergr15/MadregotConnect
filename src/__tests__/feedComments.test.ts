import { describe, expect, it } from 'vitest';
import { projectComment, validateCommentBody, MAX_COMMENT_LENGTH } from '@/lib/feed/comments';

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
