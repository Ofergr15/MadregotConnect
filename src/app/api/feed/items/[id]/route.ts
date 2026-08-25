import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, requireSession, authError } from '@/lib/auth-session';
import { FEED_SELECT, projectFeedItem } from '@/lib/feed/project';
import type { FeedMedia } from '@/lib/feed/project';

export const dynamic = 'force-dynamic';

const MAX_BODY_LENGTH = 5000;
const MAX_IMAGES = 4;

// What the "Hidden Details" chips in the activity sync editor can toggle. Stored
// as payload.hiddenFields — display-only today (no card currently reads it back
// out), but the shape is settled now so a future feed-card render pass is a
// straight read, not a schema change.
const HIDDEN_FIELDS = ['calories', 'heart_rate', 'pace', 'power'] as const;
type HiddenField = (typeof HIDDEN_FIELDS)[number];
function isHiddenField(v: unknown): v is HiddenField {
  return typeof v === 'string' && (HIDDEN_FIELDS as readonly string[]).includes(v);
}

const MAX_ACTIVITY_NAME_LENGTH = 80;
const MAX_TAG_LENGTH = 24;

/**
 * GET /api/feed/items/[id]?by=activity
 *
 * Fetch a single feed item. By default `id` is a feed_items.id. Pass
 * `?by=activity` to resolve it as an athlete_activities.id instead — the
 * activity-sync editor only has the freshly-synced activity's id (its
 * feed_item is auto-created by the trg_feed_item_for_activity trigger,
 * migration 047) and needs this to find that row.
 *
 * Read access matches every other feed route: any authenticated member may
 * read (requireSession), since the feed is club-wide.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const by = searchParams.get('by');

    const supabase = createServerClient();
    let query = supabase.from('feed_items').select(FEED_SELECT).is('deleted_at', null);
    query = by === 'activity' ? query.eq('activity_id', id) : query.eq('id', id);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Feed item not found' }, { status: 404 });

    const item = projectFeedItem(data, {
      viewerAthleteId: auth.user.athleteId,
      viewerIsStaff: auth.user.isStaff,
      likedItemIds: new Set<string>(),
    });

    return NextResponse.json({ item });
  } catch (err: unknown) {
    console.error('Feed item fetch error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}

/**
 * PATCH /api/feed/items/[id]
 * Body (all optional): { body?: string, visibility?: 'club'|'group'|'private',
 *                         media?: [{ path, url, w, h }], hiddenFields?: string[],
 *                         tag?: string | null, activityName?: string }
 *
 * Updates an existing feed_item — e.g. the caption/audience/hidden-stats an
 * athlete sets on their auto-created activity post right after a sync, or an
 * edit to a free-form post's caption/media. Only the item's own author may
 * update it (verified via the caller's JWT — never a client-supplied id).
 *
 * `hiddenFields`/`tag` merge into `payload` rather than replacing it outright,
 * so other payload keys (badge codes, plan weeks, …) added by other code
 * paths survive an edit made here. `activityName` is a second write to the
 * activity's own row (see below) since it's Garmin/Strava source data, not a
 * feed_items concern.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);

  try {
    const { id } = await params;
    const supabase = createServerClient();

    const { data: existing, error: fetchError } = await supabase
      .from('feed_items')
      .select('id, author_athlete_id, deleted_at, payload, activity_id')
      .eq('id', id)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing || existing.deleted_at) {
      return NextResponse.json({ error: 'Feed item not found' }, { status: 404 });
    }
    if (existing.author_athlete_id !== auth.user.athleteId) {
      return NextResponse.json({ error: 'Not allowed to edit this item' }, { status: 403 });
    }

    const payload = await request.json().catch(() => ({}));
    const update: Record<string, unknown> = {};

    if (typeof payload?.body === 'string') {
      const trimmed = payload.body.trim();
      if (trimmed.length > MAX_BODY_LENGTH) {
        return NextResponse.json(
          { error: `Caption is too long (max ${MAX_BODY_LENGTH})` },
          { status: 400 },
        );
      }
      update.body = trimmed || null;
    }

    if (typeof payload?.visibility === 'string') {
      if (!['club', 'group', 'private'].includes(payload.visibility)) {
        return NextResponse.json({ error: 'Invalid visibility' }, { status: 400 });
      }
      update.visibility = payload.visibility;
    }

    if (Array.isArray(payload?.media)) {
      const rawMedia: unknown[] = payload.media;
      if (rawMedia.length > MAX_IMAGES) {
        return NextResponse.json({ error: `Up to ${MAX_IMAGES} images per post` }, { status: 400 });
      }
      const media = rawMedia
        .map((m: unknown) => {
          const rec = m as { path?: unknown; url?: unknown; w?: unknown; h?: unknown };
          if (typeof rec?.path !== 'string' || !rec.path.startsWith(`${auth.user.athleteId}/`)) {
            return null;
          }
          const { data } = supabase.storage.from('feed-media').getPublicUrl(rec.path);
          return {
            path: rec.path,
            url: data.publicUrl,
            w: typeof rec.w === 'number' ? rec.w : null,
            h: typeof rec.h === 'number' ? rec.h : null,
          };
        })
        .filter((m): m is FeedMedia => m !== null);
      update.media = media.length > 0 ? media : null;
    }

    let tag: string | null | undefined;
    if (typeof payload?.tag === 'string' || payload?.tag === null) {
      const trimmed = typeof payload.tag === 'string' ? payload.tag.trim() : '';
      if (trimmed.length > MAX_TAG_LENGTH) {
        return NextResponse.json({ error: `Tag is too long (max ${MAX_TAG_LENGTH})` }, { status: 400 });
      }
      tag = trimmed || null;
    }

    if (Array.isArray(payload?.hiddenFields) || tag !== undefined) {
      const existingPayload = (existing.payload as Record<string, unknown> | null) ?? {};
      const hiddenFields = Array.isArray(payload?.hiddenFields)
        ? (payload.hiddenFields as unknown[]).filter(isHiddenField)
        : existingPayload.hiddenFields;
      update.payload = { ...existingPayload, hiddenFields, ...(tag !== undefined ? { tag } : {}) };
    }

    // The activity's own name — lives on athlete_activities (Garmin/Strava's
    // source data), not feed_items, so this is a second, separate write
    // scoped to the item's own activity and the requesting athlete's own row
    // (never a client-supplied activity id) rather than folded into `update`.
    if (typeof payload?.activityName === 'string') {
      const trimmed = payload.activityName.trim();
      if (!trimmed) {
        return NextResponse.json({ error: 'Activity name cannot be empty' }, { status: 400 });
      }
      if (trimmed.length > MAX_ACTIVITY_NAME_LENGTH) {
        return NextResponse.json({ error: `Name is too long (max ${MAX_ACTIVITY_NAME_LENGTH})` }, { status: 400 });
      }
      if (existing.activity_id) {
        const { error: nameError } = await supabase
          .from('athlete_activities')
          .update({ activity_name: trimmed })
          .eq('id', existing.activity_id)
          .eq('athlete_id', auth.user.athleteId);
        if (nameError) throw nameError;
      }
    }

    if (Object.keys(update).length === 0 && typeof payload?.activityName !== 'string') {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
    if (Object.keys(update).length === 0) {
      // Only activityName changed — nothing on feed_items itself to write,
      // just re-fetch below so the response reflects the new name.
      const { data: refetched, error: refetchError } = await supabase
        .from('feed_items')
        .select(FEED_SELECT)
        .eq('id', id)
        .single();
      if (refetchError) throw refetchError;
      const item = projectFeedItem(refetched, {
        viewerAthleteId: auth.user.athleteId,
        viewerIsStaff: auth.user.isStaff,
        likedItemIds: new Set<string>(),
      });
      return NextResponse.json({ item });
    }

    const { data: updated, error } = await supabase
      .from('feed_items')
      .update(update)
      .eq('id', id)
      .select(FEED_SELECT)
      .single();
    if (error) throw error;

    const item = projectFeedItem(updated, {
      viewerAthleteId: auth.user.athleteId,
      viewerIsStaff: auth.user.isStaff,
      likedItemIds: new Set<string>(),
    });

    return NextResponse.json({ item });
  } catch (err: unknown) {
    console.error('Feed item update error:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
