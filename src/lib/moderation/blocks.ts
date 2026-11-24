import { NextResponse } from 'next/server';

/**
 * Moderation (migration 203): content reports and member blocks.
 *
 * Blocks are one-way and private: the blocker stops seeing the blocked member's
 * feed items and comments; the blocked member is never told and sees nothing change.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const TARGET_TYPES = ['feed_item', 'comment', 'run_chat_message', 'academy_message', 'photo'] as const;
export const REASONS = ['offensive', 'harassment', 'spam', 'privacy', 'other'] as const;
export const NOTE_MAX = 500;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the error means "migration 203 is not applied" (missing table). */
export function moderationUnmigrated(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === '42P01' || e.code === 'PGRST205' || /content_reports|athlete_blocks/.test(e.message || '');
}

/** The 503 the native client reads as "fall back to /api/feedback". */
export const unmigratedResponse = () =>
  NextResponse.json({ error: 'moderation not migrated yet (203)', migrated: false }, { status: 503 });

/**
 * Everyone `viewerId` has blocked. Fails OPEN: no viewer, a missing table or a
 * failed read is an empty set, so an unapplied migration never blanks the feed.
 */
export async function blockedAuthorIds(db: Db, viewerId: string | null | undefined): Promise<Set<string>> {
  if (!viewerId) return new Set();
  try {
    const { data, error } = await db.from('athlete_blocks').select('blocked_athlete_id').eq('blocker_athlete_id', viewerId);
    if (error) return new Set();
    return new Set((data || []).map((r: { blocked_athlete_id: string }) => r.blocked_athlete_id));
  } catch {
    return new Set();
  }
}

export interface ReportInput {
  targetType: (typeof TARGET_TYPES)[number];
  targetId: string;
  authorId: string | null;
  reason: (typeof REASONS)[number];
  note: string | null;
}

export function validateReport(body: unknown): { ok: true; value: ReportInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!TARGET_TYPES.includes(b.targetType as never)) return { ok: false, error: 'invalid targetType' };
  const targetId = typeof b.targetId === 'string' ? b.targetId.trim() : '';
  if (!targetId || targetId.length > 200) return { ok: false, error: 'invalid targetId' };
  if (!REASONS.includes(b.reason as never)) return { ok: false, error: 'invalid reason' };
  let authorId: string | null = null;
  if (b.authorId != null && b.authorId !== '') {
    if (typeof b.authorId !== 'string' || !UUID_RE.test(b.authorId)) return { ok: false, error: 'invalid authorId' };
    authorId = b.authorId;
  }
  let note: string | null = null;
  if (b.note != null) {
    if (typeof b.note !== 'string') return { ok: false, error: 'invalid note' };
    if (b.note.length > NOTE_MAX) return { ok: false, error: `note exceeds ${NOTE_MAX} characters` };
    note = b.note.trim() || null;
  }
  return {
    ok: true,
    value: { targetType: b.targetType as ReportInput['targetType'], targetId, authorId, reason: b.reason as ReportInput['reason'], note },
  };
}
