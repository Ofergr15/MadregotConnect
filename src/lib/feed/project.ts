/**
 * The ONE place that decides which fields of a feed item leave the server.
 *
 * Decision 1 in docs/feed-plan.md made the feed club-wide with full data, so this
 * currently passes through HR and the route preview. It exists as a single chokepoint
 * so that tightening visibility later — dropping HR, trimming the route's start/end to
 * hide home addresses, honouring a per-athlete opt-out — is an edit to this file
 * rather than a hunt through every route and component.
 *
 * Full-resolution GPS and splits are deliberately NOT here: the feed ships
 * `route_preview` (~60 points) and the client loads full detail on expand via
 * /api/garmin/activity-details.
 */

export interface FeedAuthor {
  athleteId: string | null;
  name: string;
  avatarUrl: string | null;
  groupName: string | null;
}

export interface FeedActivity {
  id: string;
  athleteId: string;
  garminActivityId: number | null;
  activityName: string | null;
  activityType: string | null;
  startTime: string;
  distance: number;
  duration: number;
  movingDuration: number | null;
  averagePace: number | null;
  averageHr: number | null;
  maxHr: number | null;
  calories: number | null;
  elevationGain: number | null;
  locationName: string | null;
  perceivedRpe: number | null;
  perceivedFeel: number | null;
  routePreview: Array<{ lat: number; lng: number }> | null;
  hasRoute: boolean;
}

/** A member who liked an item. Same shape whether inlined or fetched in full. */
export interface FeedLiker {
  athleteId: string;
  name: string;
  avatarUrl: string | null;
}

export interface FeedMedia {
  path: string;
  url: string;
  w: number | null;
  h: number | null;
}

export interface FeedItem {
  id: string;
  type: 'activity' | 'post' | 'achievement' | 'announcement' | 'new_plan';
  author: FeedAuthor;
  body: string | null;
  media: FeedMedia[];
  payload: Record<string, unknown> | null;
  occurredAt: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  /**
   * First few likers, for the "תל ועוד 3" summary line. Capped at
   * LIKE_PREVIEW_COUNT — the full list comes from /api/feed/likes on tap, so a
   * card with 200 likes still costs the same to render.
   */
  likePreview: FeedLiker[];
  canDelete: boolean;
  activity: FeedActivity | null;
}

function toFeedItemType(type: string): FeedItem['type'] {
  switch (type) {
    case 'activity':
    case 'post':
    case 'achievement':
    case 'announcement':
    case 'new_plan':
      return type;
    default:
      throw new Error(`Unsupported feed item type: ${type}`);
  }
}

/** Shape of a joined feed_items row as selected by /api/feed. */
interface RawFeedRow {
  id: string;
  type: string;
  author_athlete_id: string | null;
  body: string | null;
  media: unknown;
  payload: unknown;
  occurred_at: string;
  like_count: number;
  comment_count: number;
  athletes?: {
    id: string;
    name: string | null;
    avatar_url: string | null;
    groups?: { name: string | null } | null;
  } | null;
  athlete_activities?: RawActivityRow | null;
}

interface RawActivityRow {
  id: string;
  athlete_id: string;
  garmin_activity_id: number | null;
  activity_name: string | null;
  activity_type: string | null;
  start_time: string;
  distance: number | null;
  duration: number | null;
  moving_duration: number | null;
  average_pace: number | null;
  average_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  elevation_gain: number | null;
  location_name: string | null;
  perceived_rpe: number | null;
  perceived_feel: number | null;
  route_preview: unknown;
  has_polyline: boolean | null;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Coerce the stored JSONB route into a clean {lat,lng}[] — tolerates bad rows. */
function toRoute(v: unknown): Array<{ lat: number; lng: number }> | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const pts = v
    .map((p) => {
      const lat = toNumber((p as { lat?: unknown })?.lat);
      const lng = toNumber((p as { lng?: unknown })?.lng);
      return lat !== null && lng !== null ? { lat, lng } : null;
    })
    .filter((p): p is { lat: number; lng: number } => p !== null);
  return pts.length > 1 ? pts : null;
}

function toMedia(v: unknown): FeedMedia[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((m) => {
      const rec = m as { path?: unknown; url?: unknown; w?: unknown; h?: unknown };
      if (typeof rec?.url !== 'string' || !rec.url) return null;
      return {
        path: typeof rec.path === 'string' ? rec.path : '',
        url: rec.url,
        w: toNumber(rec.w),
        h: toNumber(rec.h),
      };
    })
    .filter((m): m is FeedMedia => m !== null);
}

function projectActivity(row: RawActivityRow): FeedActivity {
  const route = toRoute(row.route_preview);
  return {
    id: row.id,
    athleteId: row.athlete_id,
    garminActivityId: toNumber(row.garmin_activity_id),
    activityName: row.activity_name,
    activityType: row.activity_type,
    startTime: row.start_time,
    distance: toNumber(row.distance) ?? 0,
    duration: toNumber(row.duration) ?? 0,
    movingDuration: toNumber(row.moving_duration),
    averagePace: toNumber(row.average_pace),
    averageHr: toNumber(row.average_hr),
    maxHr: toNumber(row.max_hr),
    calories: toNumber(row.calories),
    elevationGain: toNumber(row.elevation_gain),
    locationName: row.location_name,
    perceivedRpe: toNumber(row.perceived_rpe),
    perceivedFeel: toNumber(row.perceived_feel),
    routePreview: route,
    hasRoute: !!route || !!row.has_polyline,
  };
}

export interface ProjectContext {
  /** Verified athlete id of the caller (null for staff without an athlete row). */
  viewerAthleteId: string | null;
  /** Verified staff flag — staff may delete anyone's item (moderation). */
  viewerIsStaff: boolean;
  /** feed_item_ids the caller has liked, resolved in one query by the route. */
  likedItemIds: Set<string>;
  /**
   * feed_item_id -> first few likers, resolved in the same query as likedItemIds.
   * Optional so callers projecting a single freshly-created item (which has no
   * likes yet) don't have to build an empty map.
   */
  likersByItem?: Map<string, FeedLiker[]>;
}

/** How many likers ride along in the feed payload; the rest load on demand. */
export const LIKE_PREVIEW_COUNT = 3;

export function projectFeedItem(value: unknown, ctx: ProjectContext): FeedItem {
  const row = value as RawFeedRow;
  const isOwn = !!row.author_athlete_id && row.author_athlete_id === ctx.viewerAthleteId;
  const activity = row.athlete_activities ? projectActivity(row.athlete_activities) : null;

  return {
    id: row.id,
    type: toFeedItemType(row.type),
    author: {
      athleteId: row.author_athlete_id,
      name: row.athletes?.name || 'Madregot',
      avatarUrl: row.athletes?.avatar_url || null,
      groupName: row.athletes?.groups?.name || null,
    },
    body: row.body,
    media: toMedia(row.media),
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    occurredAt: row.occurred_at,
    likeCount: row.like_count ?? 0,
    commentCount: row.comment_count ?? 0,
    likedByMe: ctx.likedItemIds.has(row.id),
    likePreview: ctx.likersByItem?.get(row.id) ?? [],
    canDelete: row.type === 'post' && (ctx.viewerIsStaff || isOwn),
    activity,
  };
}

/**
 * Columns the like-list queries select. Shared by /api/feed (to build the inline
 * preview) and /api/feed/likes (the full list) so the two render identically.
 */
export const LIKER_SELECT = `
  feed_item_id, created_at,
  athletes ( id, name, avatar_url )
`;

interface RawLikeRow {
  feed_item_id: string;
  created_at: string;
  athletes?: { id: string; name: string | null; avatar_url: string | null } | null;
}

export function projectLike(value: unknown): { itemId: string; liker: FeedLiker } | null {
  const row = value as RawLikeRow;
  if (!row.athletes?.id) return null;
  return {
    itemId: row.feed_item_id,
    liker: {
      athleteId: row.athletes.id,
      name: row.athletes.name || 'Unknown',
      avatarUrl: row.athletes.avatar_url || null,
    },
  };
}

/** Columns /api/feed selects. Kept next to the projection so the two can't drift. */
export const FEED_SELECT = `
  id, type, author_athlete_id, body, media, payload, occurred_at,
  like_count, comment_count,
  athletes ( id, name, avatar_url, groups ( name ) ),
  athlete_activities (
    id, athlete_id, garmin_activity_id, activity_name, activity_type, start_time,
    distance, duration, moving_duration, average_pace, average_hr, max_hr,
    calories, elevation_gain, location_name, perceived_rpe, perceived_feel,
    route_preview, has_polyline
  )
`;
