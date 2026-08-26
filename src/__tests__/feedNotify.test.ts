import { describe, expect, it } from 'vitest';
import { buildFeedInteractionNotification, buildMentionNotification } from '@/lib/feed/notify';

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';

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

describe('buildMentionNotification', () => {
  it('returns null when the body has no mentions at all', () => {
    expect(buildMentionNotification({ body: 'no tags here', actorAthleteId: 'actor', actorName: 'Alice', kind: 'post' })).toBeNull();
  });

  it('returns null when the only mention is the author tagging themself', () => {
    const body = `@[Alice](${ALICE})`;
    expect(buildMentionNotification({ body, actorAthleteId: ALICE, actorName: 'Alice', kind: 'post' })).toBeNull();
  });

  it('returns the mentioned ids and a "tagged you in a post" title for a post', () => {
    const body = `Great run @[Bob](${BOB})!`;
    const result = buildMentionNotification({ body, actorAthleteId: ALICE, actorName: 'Alice', kind: 'post' });
    expect(result?.mentionedIds).toEqual([BOB]);
    expect(result?.title).toContain('Alice');
    expect(result?.title).toContain('בפוסט');
  });

  it('uses a "tagged you in a comment" title for a comment', () => {
    const body = `@[Bob](${BOB}) check this out`;
    const result = buildMentionNotification({ body, actorAthleteId: ALICE, actorName: 'Alice', kind: 'comment' });
    expect(result?.title).toContain('בתגובה');
  });

  it('notifies multiple distinct mentioned athletes from one body', () => {
    const CARA = '33333333-3333-3333-3333-333333333333';
    const body = `@[Bob](${BOB}) and @[Cara](${CARA}) crushed it`;
    const result = buildMentionNotification({ body, actorAthleteId: ALICE, actorName: 'Alice', kind: 'post' });
    expect(result?.mentionedIds.sort()).toEqual([BOB, CARA].sort());
  });

  it('truncates a long body preview to 80 chars with an ellipsis', () => {
    const long = 'x'.repeat(120);
    const body = `@[Bob](${BOB}) ${long}`;
    const result = buildMentionNotification({ body, actorAthleteId: ALICE, actorName: 'Alice', kind: 'post' });
    expect(result?.body.endsWith('…')).toBe(true);
    expect(result?.body.length).toBe(81);
  });

  it('falls back the actor name to "מישהו" when empty', () => {
    const body = `@[Bob](${BOB})`;
    const result = buildMentionNotification({ body, actorAthleteId: ALICE, actorName: '', kind: 'post' });
    expect(result?.title).toContain('מישהו');
  });
});
