/**
 * The ONE place that decides which fields of a feed item leave the server.
 *
 * Decision 1 in docs/feed-plan.md made the feed club-wide with full data, so this
 * currently passes through HR and the route preview. It exists as a single chokepoint
 * so that tightening visibility later — dropping HR, trimming the route's start/end to
 * hide home addresses, honouring a per-athlete opt-out — is an edit to this file
 * rather than a hunt through every route and component.
 *
 * Full-resolution GPS and the splits table are deliberately NOT here: the feed
 * ships `route_preview` (~60 points) and the client loads full detail on expand
 * via /api/garmin/activity-details. The one thing taken from `splits` is
 * `paceBands` — the per-km average paces as bare numbers, so a card's thumbnail
 * can draw the pace heat map — and it is masked alongside `averagePace`.
 */

import type { FeedComment } from '@/lib/feed/comments';

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
  /**
   * Average pace per kilometre, seconds/km, for the thumbnail's pace heat map.
   * Null when the run has no cached splits. Blanked with `averagePace` when the
   * athlete has hidden their pace.
   */
  paceBands: number[] | null;
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
  /**
   * The last couple of comments, so a card shows the conversation instead of
   * just a number that has to be tapped to mean anything. Capped at
   * COMMENT_PREVIEW_COUNT — the full thread comes from /api/feed/comments.
   */
  commentPreview: FeedComment[];
  canDelete: boolean;
  activity: FeedActivity | null;
}

/**
 * `payload` shape for `type === 'achievement'` items, per the award-evaluation
 * engine's fixed contract (a separate task — this file only reads it). Narrowed
 * here rather than trusted as-is by the client, since `payload` is stored as
 * opaque JSONB with no DB-level shape guarantee.
 */
export interface AchievementPayload {
  badgeCode: string;
  badgeIcon: string;
  badgeNameHe: string;
  badgeNameEn: string;
}

/** Safely narrows a feed item's generic payload to the achievement contract.
 * Returns null on anything malformed/missing so the card can fall back to the
 * generic PostCard rather than render broken text. */
export function toAchievementPayload(payload: Record<string, unknown> | null): AchievementPayload | null {
  if (!payload) return null;
  const { badgeCode, badgeIcon, badgeNameHe, badgeNameEn } = payload;
  if (
    typeof badgeCode !== 'string' ||
    typeof badgeIcon !== 'string' ||
    typeof badgeNameHe !== 'string' ||
    typeof badgeNameEn !== 'string'
  ) {
    return null;
  }
  return { badgeCode, badgeIcon, badgeNameHe, badgeNameEn };
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
  splits: unknown;
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

/**
 * Per-kilometre average paces, in seconds per km, from the cached `splits` — the
 * only thing the feed needs to draw a pace heat map on a card's thumbnail.
 *
 * Just the paces: distance, duration and HR per split stay off the wire. Two
 * splits minimum, because a single number is not a heat map.
 *
 * Often `null`, and that's expected — `splits` is populated when a run is synced
 * from Strava or the first time someone opens its detail page, so older runs
 * nobody has opened have none. A card with no bands just draws its usual single
 * colour.
 */
function toPaceBands(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const paces = v
    .map((s) => toNumber((s as { averagePace?: unknown })?.averagePace))
    .filter((p): p is number => p !== null && p > 0);
  return paces.length === v.length && paces.length > 1 ? paces : null;
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
    paceBands: toPaceBands(row.splits),
  };
}

/**
 * Stats an athlete can hide from their own card in the share sheet
 * (`ActivitySyncEditor`'s hidden-details toggles, stored as
 * `payload.hiddenFields` by PATCH /api/feed/items/[id]).
 *
 * Kept identical to `HIDDEN_FIELDS` there and to `FeedHiddenField` in
 * feed-client.ts. Until now the flag was written and honoured nowhere, so a stat
 * the athlete explicitly chose to hide still went out on the card — the gap
 * flagged in CLAUDE.md. It is enforced HERE rather than in FeedCard on purpose:
 * this is the chokepoint every feed consumer goes through (the card, the share
 * sheet's story image, /api/feed/items/[id]), and a value that never leaves the
 * server can't be read out of the network response either.
 */
const HIDDEN_FIELD_KEYS = ['calories', 'heart_rate', 'pace', 'power'] as const;
type HiddenFieldKey = (typeof HIDDEN_FIELD_KEYS)[number];

function readHiddenFields(payload: Record<string, unknown> | null): Set<HiddenFieldKey> {
  const raw = payload?.hiddenFields;
  if (!Array.isArray(raw)) return new Set();
  return new Set(
    raw.filter((v): v is HiddenFieldKey => (HIDDEN_FIELD_KEYS as readonly unknown[]).includes(v)),
  );
}

/**
 * Blanks the hidden stats, for everyone including the athlete themselves — the
 * card they see is then exactly the card the club sees, which is the whole point
 * of the toggle. Their own full numbers are still one tap away on the activity
 * detail page, and the share sheet drives its toggles off `payload.hiddenFields`
 * (which still ships) rather than off these values.
 *
 * `power` has no column in FeedActivity yet; it stays in the key list so the
 * toggle keeps round-tripping and this starts working the day the column lands.
 */
function maskHiddenStats(activity: FeedActivity, hidden: Set<HiddenFieldKey>): FeedActivity {
  if (hidden.size === 0) return activity;
  return {
    ...activity,
    calories: hidden.has('calories') ? null : activity.calories,
    averageHr: hidden.has('heart_rate') ? null : activity.averageHr,
    maxHr: hidden.has('heart_rate') ? null : activity.maxHr,
    averagePace: hidden.has('pace') ? null : activity.averagePace,
    // Per-km paces are finer-grained pace, not a different stat: leaving them in
    // would let anyone read off a hidden average from the card's own heat map
    // (and, colours aside, straight out of the JSON).
    paceBands: hidden.has('pace') ? null : activity.paceBands,
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
  /**
   * feed_item_id -> newest few comments, oldest-first, from the same one query.
   * Optional for the same reason as likersByItem: a freshly-created item has no
   * comments, so single-item callers needn't build an empty map.
   */
  commentsByItem?: Map<string, FeedComment[]>;
}

/** How many likers ride along in the feed payload; the rest load on demand. */
export const LIKE_PREVIEW_COUNT = 3;

export function projectFeedItem(value: unknown, ctx: ProjectContext): FeedItem {
  const row = value as RawFeedRow;
  const isOwn = !!row.author_athlete_id && row.author_athlete_id === ctx.viewerAthleteId;
  const payload = (row.payload as Record<string, unknown> | null) ?? null;
  const activity = row.athlete_activities
    ? maskHiddenStats(projectActivity(row.athlete_activities), readHiddenFields(payload))
    : null;

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
    payload,
    occurredAt: row.occurred_at,
    likeCount: row.like_count ?? 0,
    commentCount: row.comment_count ?? 0,
    likedByMe: ctx.likedItemIds.has(row.id),
    likePreview: ctx.likersByItem?.get(row.id) ?? [],
    commentPreview: ctx.commentsByItem?.get(row.id) ?? [],
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
    route_preview, has_polyline, splits
  )
`;
