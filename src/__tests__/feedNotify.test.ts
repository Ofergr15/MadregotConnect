import { describe, expect, it } from 'vitest';
import { buildFeedInteractionNotification } from '@/lib/feed/notify';

describe('buildFeedInteractionNotification', () => {
  it('returns null for a system item with no author — nobody to notify', () => {
    expect(buildFeedInteractionNotification({
      authorAthleteId: null, actorAthleteId: 'a1', actorName: 'Alice', kind: 'like',
    })).toBeNull();
  });

  it("returns null when the actor is the item's own author — never notify yourself", () => {
    expect(buildFeedInteractionNotification({
      authorAthleteId: 'a1', actorAthleteId: 'a1', actorName: 'Alice', kind: 'like',
    })).toBeNull();
  });

  it('builds a like notification with a generic body (no content preview for likes)', () => {
    const result = buildFeedInteractionNotification({
      authorAthleteId: 'author', actorAthleteId: 'actor', actorName: 'Alice', kind: 'like',
    });
    expect(result?.title).toContain('Alice');
    expect(result?.title).toContain('אהב');
    expect(result?.body).toBe('היכנסו לפיד כדי לראות');
  });

  it('builds a comment notification that previews the actual comment text', () => {
    const result = buildFeedInteractionNotification({
      authorAthleteId: 'author', actorAthleteId: 'actor', actorName: 'Alice', kind: 'comment', commentBody: 'Nice run today!',
    });
    expect(result?.title).toContain('הגיב');
    expect(result?.body).toBe('Nice run today!');
  });

  it('truncates a long comment preview to 80 chars with an ellipsis', () => {
    const long = 'x'.repeat(120);
    const result = buildFeedInteractionNotification({
      authorAthleteId: 'author', actorAthleteId: 'actor', actorName: 'Alice', kind: 'comment', commentBody: long,
    });
    expect(result?.body).toBe(`${'x'.repeat(80)}…`);
  });

  it('falls back to a generic prompt when a comment notification has no body text at all', () => {
    const result = buildFeedInteractionNotification({
      authorAthleteId: 'author', actorAthleteId: 'actor', actorName: 'Alice', kind: 'comment', commentBody: '   ',
    });
    expect(result?.body).toBe('היכנסו לפיד כדי לראות');
  });

  it('falls back the actor name to a generic "מישהו" when actorName is empty', () => {
    const result = buildFeedInteractionNotification({
      authorAthleteId: 'author', actorAthleteId: 'actor', actorName: '', kind: 'like',
    });
    expect(result?.title).toContain('מישהו');
  });
});
