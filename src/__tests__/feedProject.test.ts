import { describe, expect, it } from 'vitest';
import { projectFeedItem, projectLike } from '@/lib/feed/project';

const baseRow = {
  id: 'feed-1',
  type: 'post',
  author_athlete_id: 'athlete-1',
  body: 'Hello',
  media: [],
  payload: null,
  occurred_at: '2026-08-09T12:00:00.000Z',
  like_count: 2,
  comment_count: 1,
  athletes: {
    id: 'athlete-1',
    name: 'Tal Boren',
    avatar_url: null,
    groups: { name: 'Madregot' },
  },
  athlete_activities: null,
};

const context = {
  viewerAthleteId: 'athlete-1',
  viewerIsStaff: false,
  likedItemIds: new Set(['feed-1']),
};

describe('feed projection', () => {
  it('projects viewer state and post deletion capability', () => {
    const item = projectFeedItem(baseRow, context);

    expect(item).toMatchObject({
      id: 'feed-1',
      type: 'post',
      likedByMe: true,
      canDelete: true,
      likeCount: 2,
      commentCount: 1,
    });
  });

  it('only exposes deletion for posts', () => {
    const item = projectFeedItem(
      { ...baseRow, type: 'activity' },
      { ...context, viewerIsStaff: true },
    );

    expect(item.canDelete).toBe(false);
  });

  it('rejects unknown item types', () => {
    expect(() => projectFeedItem({ ...baseRow, type: 'poll' }, context))
      .toThrow('Unsupported feed item type: poll');
  });

  it('projects joined liker rows', () => {
    expect(projectLike({
      feed_item_id: 'feed-1',
      created_at: '2026-08-09T12:00:00.000Z',
      athletes: { id: 'athlete-2', name: 'Ronit', avatar_url: null },
    })).toEqual({
      itemId: 'feed-1',
      liker: { athleteId: 'athlete-2', name: 'Ronit', avatarUrl: null },
    });
  });
});
