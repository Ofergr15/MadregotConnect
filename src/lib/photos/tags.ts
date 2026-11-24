import type { SupabaseClient } from '@supabase/supabase-js';

type Db = SupabaseClient<any, any, any>;

/**
 * Manual photo tags (migration 214). No face recognition.
 *
 * Rules (pinned by src/__tests__/photoTags.test.ts):
 * - Any verified member may tag a member in a photo of the session-photos library.
 * - Tagging yourself is approved at once; tagging someone else is `pending` until THEY approve.
 * - Only approved tags are shown to other members. A pending tag is visible to the tagged person
 *   and to whoever made it, nobody else.
 * - The tagged person may remove any tag of them; the tagger may remove a tag they made while it is
 *   still pending; staff may remove any tag.
 */
export type TagStatus = 'pending' | 'approved';

export interface PhotoTagRow {
  id: string; photo_id: string; folder_id: string; athlete_id: string;
  tagged_by: string | null; status: TagStatus; created_at: string; approved_at: string | null;
}

export interface TagActor { athleteId: string; isStaff: boolean }

export function initialStatus(actor: TagActor, athleteId: string): TagStatus {
  return actor.athleteId === athleteId ? 'approved' : 'pending';
}

export function mayRemove(actor: TagActor, tag: Pick<PhotoTagRow, 'athlete_id' | 'tagged_by' | 'status'>): boolean {
  if (actor.isStaff) return true;
  if (tag.athlete_id === actor.athleteId) return true;
  return tag.status === 'pending' && tag.tagged_by === actor.athleteId;
}

export function mayApprove(actor: TagActor, tag: Pick<PhotoTagRow, 'athlete_id'>): boolean {
  return tag.athlete_id === actor.athleteId;
}

/** What a viewer may see of a tag: approved ones, plus pending ones they are in or made. */
export function visibleTo(viewer: TagActor, tag: Pick<PhotoTagRow, 'athlete_id' | 'tagged_by' | 'status'>): boolean {
  return tag.status === 'approved' || tag.athlete_id === viewer.athleteId || tag.tagged_by === viewer.athleteId;
}

/** The projection a client gets: the tagged person's id and display name, never an email or contact. */
export interface PublicTag {
  photoId: string; folderId: string; athleteId: string; name: string;
  status: TagStatus; mine: boolean; byMe: boolean;
}

export function project(viewer: TagActor, rows: PhotoTagRow[], names: Map<string, string>): PublicTag[] {
  return rows.filter((t) => visibleTo(viewer, t)).map((t) => ({
    photoId: t.photo_id, folderId: t.folder_id, athleteId: t.athlete_id, name: names.get(t.athlete_id) ?? '',
    status: t.status, mine: t.athlete_id === viewer.athleteId, byMe: t.tagged_by === viewer.athleteId,
  }));
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;
export const isDriveId = (v: unknown): v is string => typeof v === 'string' && DRIVE_ID.test(v);

/** Missing table (214 not pasted yet) → the routes answer 503 rather than 500. */
export const missingTable = (e: { code?: string } | null | undefined) => e?.code === '42P01' || e?.code === 'PGRST205';

export async function namesFor(db: Db, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const { data } = await db.from('athletes').select('id, name').in('id', uniq);
  return new Map(((data || []) as Array<{ id: string; name: string | null }>).map((a) => [a.id, a.name ?? '']));
}
