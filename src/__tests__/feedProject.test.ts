import { describe, expect, it } from 'vitest';
import { projectFeedItem, projectLike, toAchievementPayload } from '@/lib/feed/project';

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

  it('projectLike returns null when the joined athlete row is missing (deleted/orphaned athlete)', () => {
    expect(projectLike({ feed_item_id: 'feed-1', created_at: '2026-08-09T12:00:00.000Z', athletes: null })).toBeNull();
  });

  it('staff CAN delete another athlete\'s post (moderation) — the case the earlier test never actually exercised', () => {
    const item = projectFeedItem(
      { ...baseRow, author_athlete_id: 'someone-else', type: 'post' },
      { ...context, viewerIsStaff: true },
    );
    expect(item.canDelete).toBe(true);
  });

  it('a non-staff, non-author viewer cannot delete a post', () => {
    const item = projectFeedItem(
      { ...baseRow, author_athlete_id: 'someone-else', type: 'post' },
      context,
    );
    expect(item.canDelete).toBe(false);
  });

  it('falls back the author name to "Madregot" when no athlete row is joined (system-authored item)', () => {
    const item = projectFeedItem({ ...baseRow, athletes: null, author_athlete_id: null }, context);
    expect(item.author.name).toBe('Madregot');
  });

  it('likedByMe and likePreview default to false/empty when the context has no entries for this item', () => {
    const item = projectFeedItem(baseRow, { ...context, likedItemIds: new Set() });
    expect(item.likedByMe).toBe(false);
    expect(item.likePreview).toEqual([]);
  });

  it('projects a full activity row, coercing numeric-string DB fields and deriving hasRoute from a real route', () => {
    const item = projectFeedItem({
      ...baseRow,
      type: 'activity',
      athlete_activities: {
        id: 'act-1', athlete_id: 'athlete-1', garmin_activity_id: 12345,
        activity_name: 'Morning Run', activity_type: 'running', start_time: '2026-08-09T06:00:00.000Z',
        distance: '10000', duration: '3000', moving_duration: null,
        average_pace: '5.0', average_hr: '150', max_hr: '175', calories: '600',
        elevation_gain: '50', location_name: 'Tel Aviv', perceived_rpe: '7', perceived_feel: '3',
        route_preview: [{ lat: 32.0, lng: 34.0 }, { lat: 32.1, lng: 34.1 }],
        has_polyline: false,
      },
    }, context);
    expect(item.activity).toMatchObject({
      distance: 10000, averageHr: 150, hasRoute: true,
      routePreview: [{ lat: 32.0, lng: 34.0 }, { lat: 32.1, lng: 34.1 }],
    });
  });

  it('a malformed route (fewer than 2 valid points) is dropped, but hasRoute still true if has_polyline says so', () => {
    const item = projectFeedItem({
      ...baseRow, type: 'activity',
      athlete_activities: {
        id: 'act-1', athlete_id: 'athlete-1', garmin_activity_id: null,
        activity_name: null, activity_type: null, start_time: '2026-08-09T06:00:00.000Z',
        distance: 1000, duration: 300, moving_duration: null, average_pace: null, average_hr: null,
        max_hr: null, calories: null, elevation_gain: null, location_name: null,
        perceived_rpe: null, perceived_feel: null,
        route_preview: [{ lat: 32.0, lng: 34.0 }], // only one valid point
        has_polyline: true,
      },
    }, context);
    expect(item.activity?.routePreview).toBeNull();
    expect(item.activity?.hasRoute).toBe(true);
  });

  it('a route point missing lat/lng is filtered out rather than crashing the projection', () => {
    const item = projectFeedItem({
      ...baseRow, type: 'activity',
      athlete_activities: {
        id: 'act-1', athlete_id: 'athlete-1', garmin_activity_id: null,
        activity_name: null, activity_type: null, start_time: '2026-08-09T06:00:00.000Z',
        distance: 1000, duration: 300, moving_duration: null, average_pace: null, average_hr: null,
        max_hr: null, calories: null, elevation_gain: null, location_name: null,
        perceived_rpe: null, perceived_feel: null,
        route_preview: [{ lat: 32.0, lng: 34.0 }, { lat: null, lng: 34.1 }, { lat: 32.2, lng: 34.2 }],
        has_polyline: false,
      },
    }, context);
    expect(item.activity?.routePreview).toEqual([{ lat: 32.0, lng: 34.0 }, { lat: 32.2, lng: 34.2 }]);
  });

  it('malformed media entries (no url) are dropped; valid ones keep their path/url/dimensions', () => {
    const item = projectFeedItem({
      ...baseRow,
      media: [
        { path: 'a/1.jpg', url: 'https://x/1.jpg', w: 800, h: 600 },
        { path: 'a/2.jpg' }, // no url — invalid, must be dropped
        'not-even-an-object',
      ],
    }, context);
    expect(item.media).toEqual([{ path: 'a/1.jpg', url: 'https://x/1.jpg', w: 800, h: 600 }]);
  });

  it('activity is null when no athlete_activities row is joined', () => {
    expect(projectFeedItem(baseRow, context).activity).toBeNull();
  });
});

describe('toAchievementPayload', () => {
  it('narrows a well-formed achievement payload', () => {
    const payload = { badgeCode: 'first_run', badgeIcon: '🏃', badgeNameHe: 'ריצה ראשונה', badgeNameEn: 'First Run' };
    expect(toAchievementPayload(payload)).toEqual(payload);
  });

  it('returns null for a null payload', () => {
    expect(toAchievementPayload(null)).toBeNull();
  });

  it('returns null when any required field is missing', () => {
    expect(toAchievementPayload({ badgeCode: 'x', badgeIcon: '🏃', badgeNameHe: 'x' })).toBeNull();
  });

  it('returns null when a field has the wrong type (defends against untyped JSONB drift)', () => {
    expect(toAchievementPayload({ badgeCode: 'x', badgeIcon: '🏃', badgeNameHe: 'x', badgeNameEn: 42 })).toBeNull();
  });

  it('returns null for an unrelated payload shape (e.g. a plan-week payload read as an achievement)', () => {
    expect(toAchievementPayload({ weekNumber: 3, planId: 'abc' })).toBeNull();
  });
});
