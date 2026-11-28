// Content-report moderation (task 185): what staff can do with a report, and the audit trail.
//
// Reports (migration 203) are per reporter; the content is per target. So every decision is taken
// on the TARGET: dismissing, resolving or hiding closes every open report on that target at once,
// and one row in moderation_actions (migration 348) says who decided what, when, and how many
// reports it closed. Nothing here notifies anybody — not the reporters, not the author.
//
// "Hide" uses each target's own soft delete, so every existing reader already respects it:
//   feed_item / comment         → deleted_at = now() (the feed and the comment counters skip it)
//   *_chat_message / academy    → Stream soft delete (the bubble reads "deleted" for everyone)
//   photo                       → not hideable here (Drive photos aren't ours to delete) → 422
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StreamChat } from 'stream-chat';
import { isMissingTable } from '@/lib/supabase/schema-drift';

export const MODERATION_ACTIONS = ['dismiss', 'resolve', 'hide'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/** The content_reports status each action leaves the target's open reports in. */
export const STATUS_AFTER: Record<ModerationAction, 'dismissed' | 'actioned'> = {
  dismiss: 'dismissed', resolve: 'actioned', hide: 'actioned',
};

export const NOTE_MAX = 500;
export const LIST_PAGE_DEFAULT = 50;
export const LIST_PAGE_MAX = 100;

const SOFT_DELETE_TABLE: Record<string, string> = { feed_item: 'feed_items', comment: 'feed_comments' };
const STREAM_TARGETS = new Set(['run_chat_message', 'academy_message', 'group_chat_message']);

export const isHideable = (targetType: string) => targetType in SOFT_DELETE_TABLE || STREAM_TARGETS.has(targetType);

export function parseAction(body: unknown):
  { ok: true; value: { reportId: string; action: ModerationAction; note: string | null } } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const reportId = typeof b.reportId === 'string' ? b.reportId.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reportId)) return { ok: false, error: 'invalid reportId' };
  if (!MODERATION_ACTIONS.includes(b.action as ModerationAction)) return { ok: false, error: 'action must be dismiss, resolve or hide' };
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null;
  if (note && note.length > NOTE_MAX) return { ok: false, error: 'note too long' };
  return { ok: true, value: { reportId, action: b.action as ModerationAction, note } };
}

/** Keyset cursor over (created_at DESC, id DESC): `<iso>|<uuid>`. Null for junk. */
export function parseCursor(raw: string | null): { at: string; id: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:?\d{2}))\|([0-9a-f-]{36})$/i.exec(raw || '');
  return m && Number.isFinite(Date.parse(m[1])) ? { at: m[1], id: m[2] } : null;
}
export const cursorOf = (r: { created_at: string; id: string }) => `${r.created_at}|${r.id}`;

/**
 * Hide one target. Idempotent: an already-hidden feed row is left with its first deleted_at, and
 * Stream's "already deleted" counts as done. Returns 'hidden', 'missing' (no such content — the
 * reports can still be closed) or 'unsupported'.
 */
export async function hideTarget(
  db: SupabaseClient, stream: () => StreamChat, targetType: string, targetId: string, now = new Date(),
): Promise<'hidden' | 'missing' | 'unsupported'> {
  const table = SOFT_DELETE_TABLE[targetType];
  if (table) {
    const { data, error } = await db.from(table).update({ deleted_at: now.toISOString() })
      .eq('id', targetId).is('deleted_at', null).select('id');
    if (error) throw new Error(error.message);
    if (data?.length) return 'hidden';
    const { data: row } = await db.from(table).select('id').eq('id', targetId).maybeSingle();
    return row ? 'hidden' : 'missing';
  }
  if (STREAM_TARGETS.has(targetType)) {
    try {
      await stream().deleteMessage(targetId);
      return 'hidden';
    } catch (err) {
      const msg = String(err);
      if (/already deleted/i.test(msg)) return 'hidden';
      if (/not found|does not exist/i.test(msg)) return 'missing';
      throw err;
    }
  }
  return 'unsupported';
}

export interface ModerationAuditRow {
  report_id: string;
  target_type: string;
  target_id: string;
  action: ModerationAction;
  outcome: string;
  actor_athlete_id: string | null;
  note: string | null;
  reports_closed: number;
}

/** Writes the audit row. Before migration 348 the table is missing: the decision stands, logged. */
export async function auditModeration(db: SupabaseClient, row: ModerationAuditRow): Promise<'ok' | 'unmigrated'> {
  const { error } = await db.from('moderation_actions').insert(row);
  if (!error) return 'ok';
  if (isMissingTable(error)) {
    console.warn('moderation audit: migration 348 not applied — action not audited', row.action, row.target_type);
    return 'unmigrated';
  }
  throw new Error(error.message);
}
