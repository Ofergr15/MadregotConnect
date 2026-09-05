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

// The share sheet's "hidden details" toggles were written to
// payload.hiddenFields and then honoured nowhere, so a stat the athlete
// explicitly hid still went out on the card. These lock the masking to the
// projection, which is the only layer a client can't go around.
describe('feed projection — payload.hiddenFields', () => {
  const activityRow = {
    id: 'act-1',
    athlete_id: 'athlete-1',
    garmin_activity_id: 555,
    activity_name: 'Morning run',
    activity_type: 'running',
    start_time: '2026-08-09T06:00:00.000Z',
    distance: 10000,
    duration: 3000,
    moving_duration: 2980,
    average_pace: 300,
    average_hr: 152,
    max_hr: 178,
    calories: 640,
    elevation_gain: 40,
    location_name: 'Tel Aviv',
    perceived_rpe: 6,
    perceived_feel: 3,
    route_preview: null,
    has_polyline: true,
    splits: [{ averagePace: 280 }, { averagePace: 300 }, { averagePace: 330 }],
  };

  const project = (hiddenFields: unknown) =>
    projectFeedItem(
      { ...baseRow, type: 'activity', payload: { hiddenFields }, athlete_activities: activityRow },
      context,
    ).activity!;

  it('ships every stat when nothing is hidden', () => {
    const activity = project([]);
    expect(activity).toMatchObject({ calories: 640, averageHr: 152, maxHr: 178, averagePace: 300 });
  });

  it('blanks calories when hidden, leaving the others alone', () => {
    const activity = project(['calories']);
    expect(activity.calories).toBeNull();
    expect(activity).toMatchObject({ averageHr: 152, maxHr: 178, averagePace: 300 });
  });

  it('heart_rate hides BOTH average and max — a max HR alone still leaks the effort', () => {
    const activity = project(['heart_rate']);
    expect(activity.averageHr).toBeNull();
    expect(activity.maxHr).toBeNull();
  });

  it('blanks pace when hidden', () => {
    expect(project(['pace']).averagePace).toBeNull();
  });

  // The thumbnail's pace heat map is drawn from these. They are pace at a finer
  // grain than the average, so hiding "pace" and shipping them would hand back
  // the number the athlete just hid — visibly in the colours, exactly in the JSON.
  it('per-km paceBands ship with pace, and go when pace is hidden', () => {
    expect(project([]).paceBands).toEqual([280, 300, 330]);
    expect(project(['pace']).paceBands).toBeNull();
  });

  it('hides everything asked for at once', () => {
    expect(project(['calories', 'heart_rate', 'pace'])).toMatchObject({
      calories: null, averageHr: null, maxHr: null, averagePace: null,
    });
  });

  it('masks the athlete\'s own card too — what they see is what the club sees', () => {
    const item = projectFeedItem(
      {
        ...baseRow,
        type: 'activity',
        author_athlete_id: 'athlete-1',
        payload: { hiddenFields: ['pace'] },
        athlete_activities: activityRow,
      },
      { ...context, viewerAthleteId: 'athlete-1' },
    );
    expect(item.activity!.averagePace).toBeNull();
  });

  it('still ships payload.hiddenFields, which is what the share sheet reads its toggles from', () => {
    const item = projectFeedItem(
      { ...baseRow, type: 'activity', payload: { hiddenFields: ['pace'] }, athlete_activities: activityRow },
      context,
    );
    expect(item.payload).toEqual({ hiddenFields: ['pace'] });
  });

  it('ignores unknown field names rather than blanking something arbitrary', () => {
    expect(project(['location', 'distance'])).toMatchObject({ calories: 640, averagePace: 300 });
  });

  // payload is opaque JSONB with no DB-level shape guarantee.
  it('tolerates a malformed hiddenFields (not an array, or mixed junk)', () => {
    expect(project('pace')).toMatchObject({ averagePace: 300 });
    expect(project([null, 42, 'pace'])).toMatchObject({ averagePace: null, calories: 640 });
  });

  it('distance and duration are never maskable — the card would have nothing left', () => {
    expect(project(['calories', 'heart_rate', 'pace'])).toMatchObject({ distance: 10000, duration: 3000 });
  });
});

// `splits` is JSONB cached opportunistically (Strava sync, or the first time
// anyone opens the run's detail), so "no bands" is the normal case for older
// runs and must never be an error — a card with none just draws a plain line.
describe('feed projection — paceBands', () => {
  const row = (splits: unknown) => ({
    ...baseRow,
    type: 'activity' as const,
    athlete_activities: {
      id: 'act-1', athlete_id: 'athlete-1', garmin_activity_id: null,
      activity_name: null, activity_type: null, start_time: '2026-08-09T06:00:00.000Z',
      distance: 5000, duration: 1500, moving_duration: null, average_pace: 300,
      average_hr: null, max_hr: null, calories: null, elevation_gain: null,
      location_name: null, perceived_rpe: null, perceived_feel: null,
      route_preview: null, has_polyline: false, splits,
    },
  });
  const bands = (splits: unknown) => projectFeedItem(row(splits), context).activity!.paceBands;

  it('is null when the run has no cached splits at all', () => {
    expect(bands(null)).toBeNull();
    expect(bands([])).toBeNull();
  });

  it('is null for a single split — one number is not a heat map', () => {
    expect(bands([{ averagePace: 300 }])).toBeNull();
  });

  it('carries only the paces, not the rest of each split', () => {
    expect(bands([
      { averagePace: 290, distance: 1000, duration: 290, averageHR: 150 },
      { averagePace: 310, distance: 1000, duration: 310, averageHR: 158 },
    ])).toEqual([290, 310]);
  });

  it('drops the whole set if any split is missing a usable pace, rather than mis-colouring the rest', () => {
    expect(bands([{ averagePace: 290 }, { averagePace: null }, { averagePace: 310 }])).toBeNull();
    expect(bands([{ averagePace: 290 }, { averagePace: 0 }])).toBeNull();
    expect(bands(['not-a-split', { averagePace: 310 }])).toBeNull();
  });

  it('tolerates a splits value that is not an array', () => {
    expect(bands('splits')).toBeNull();
    expect(bands({ averagePace: 300 })).toBeNull();
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
