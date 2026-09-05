import { describe, expect, it } from 'vitest';
import { buildMentionNotification, likeAnnouncement, shouldNotifyFeedInteraction } from '@/lib/feed/notify';
import { feedInteractionCopy, kudosCopy, mentionCopy } from '@/lib/notifications/copy';

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';

// The title/body construction these two used to own now lives in
// notifications/copy.ts, because the wording depends on the recipient's chosen
// language and that isn't known until the send path resolves it. What's left
// here is the part with a decision in it — who gets notified — and the copy
// module's own assertions moved down into the second block.

describe('shouldNotifyFeedInteraction', () => {
  it('is false for a system item with no author — nobody to notify', () => {
    expect(shouldNotifyFeedInteraction({
      authorAthleteId: null, actorAthleteId: 'a1', actorName: 'Alice', kind: 'like',
    })).toBe(false);
  });

  it("is false when the actor is the item's own author — never notify yourself", () => {
    expect(shouldNotifyFeedInteraction({
      authorAthleteId: 'a1', actorAthleteId: 'a1', actorName: 'Alice', kind: 'like',
    })).toBe(false);
  });

  it('is true when someone else interacts with your item', () => {
    expect(shouldNotifyFeedInteraction({
      authorAthleteId: 'author', actorAthleteId: 'actor', actorName: 'Alice', kind: 'like',
    })).toBe(true);
  });
});

// A ❤️ on a run card and a 👍 on the run's push notification are one row in
// feed_likes (migration 088 folded activity_kudos into it), so they have to be
// announced with one wording — whichever button the athlete actually tapped.
describe('likeAnnouncement', () => {
  it('announces a like on a run as kudos, and stores it under that kind', () => {
    expect(likeAnnouncement('activity')).toEqual({ isKudos: true, historyKind: 'kudos' });
  });

  it('leaves a like on a post, announcement or achievement as a plain like', () => {
    for (const type of ['post', 'announcement', 'achievement', 'new_plan']) {
      expect(likeAnnouncement(type)).toEqual({ isKudos: false, historyKind: 'like' });
    }
  });

  it('treats an unknown or absent item type as a plain like — never invents a kudos', () => {
    expect(likeAnnouncement(null).isKudos).toBe(false);
    expect(likeAnnouncement(undefined).isKudos).toBe(false);
    expect(likeAnnouncement('').isKudos).toBe(false);
  });

  it('gives the run case the same copy the notification 👍 has always used', () => {
    expect(kudosCopy('he', { name: 'Alice' }).title).toContain('כיף');
    expect(kudosCopy('en', { name: 'Alice' }).title).toBe('Alice gave you kudos on your run! 👍');
  });
});

describe('feedInteractionCopy', () => {
  it('gives a like a generic body — there is no content to preview', () => {
    const he = feedInteractionCopy('he', { name: 'Alice', kind: 'like' });
    expect(he.title).toContain('Alice');
    expect(he.title).toContain('אהב');
    expect(he.body).toBe('היכנסו לפיד כדי לראות');

    const en = feedInteractionCopy('en', { name: 'Alice', kind: 'like' });
    expect(en.title).toBe('Alice liked your post ❤️');
    expect(en.body).toBe('Open the feed to take a look');
  });

  it('previews the actual comment text', () => {
    expect(feedInteractionCopy('he', { name: 'Alice', kind: 'comment', commentBody: 'Nice run today!' }))
      .toMatchObject({ body: 'Nice run today!' });
    expect(feedInteractionCopy('en', { name: 'Alice', kind: 'comment', commentBody: 'Nice run today!' }))
      .toEqual({ title: 'Alice commented on your post 💬', body: 'Nice run today!' });
  });

  it('truncates a long comment preview to 80 chars with an ellipsis, in both languages', () => {
    const long = 'x'.repeat(120);
    for (const locale of ['he', 'en'] as const) {
      expect(feedInteractionCopy(locale, { name: 'Alice', kind: 'comment', commentBody: long }).body)
        .toBe(`${'x'.repeat(80)}…`);
    }
  });

  it('falls back to a generic prompt when a comment has no body text at all', () => {
    expect(feedInteractionCopy('he', { name: 'Alice', kind: 'comment', commentBody: '   ' }).body)
      .toBe('היכנסו לפיד כדי לראות');
    expect(feedInteractionCopy('en', { name: 'Alice', kind: 'comment', commentBody: '   ' }).body)
      .toBe('Open the feed to take a look');
  });

  it('falls back the actor name to a generic one, in the reader\'s own language', () => {
    // A Hebrew "מישהו" wedged into an otherwise-English notification is exactly
    // the seam the copy module exists to close.
    expect(feedInteractionCopy('he', { name: '', kind: 'like' }).title).toContain('מישהו');
    expect(feedInteractionCopy('en', { name: '', kind: 'like' }).title).toContain('Someone');
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

  it('returns the mentioned ids', () => {
    const body = `Great run @[Bob](${BOB})!`;
    const result = buildMentionNotification({ body, actorAthleteId: ALICE, actorName: 'Alice', kind: 'post' });
    expect(result?.mentionedIds).toEqual([BOB]);
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
});

describe('mentionCopy', () => {
  it('distinguishes a post from a comment', () => {
    expect(mentionCopy('he', { name: 'Alice', kind: 'post' }).title).toContain('בפוסט');
    expect(mentionCopy('he', { name: 'Alice', kind: 'comment' }).title).toContain('בתגובה');
    expect(mentionCopy('en', { name: 'Alice', kind: 'post' }).title).toBe('Alice mentioned you in a post 🏷️');
    expect(mentionCopy('en', { name: 'Alice', kind: 'comment' }).title).toBe('Alice mentioned you in a comment 🏷️');
  });

  it('falls back the actor name in each language', () => {
    expect(mentionCopy('he', { name: '', kind: 'post' }).title).toContain('מישהו');
    expect(mentionCopy('en', { name: '', kind: 'post' }).title).toContain('Someone');
  });
});
