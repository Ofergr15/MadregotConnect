/**
 * Staff follow-up on a pain report (task 187, migration 351): open → contacted → closed,
 * with private notes. Pure; the routes are /api/pain-reports/{id}/followup and
 * /api/pain-reports/followups.
 *
 * Any status may move to any other — a "closed" runner who rings again is reopened, and
 * a mis-tap is undone — but every move is a row, so nothing is lost.
 */

export const FOLLOWUP_STATUSES = ['open', 'contacted', 'closed'] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];
export const FOLLOWUP_NOTE_MAX = 1000;

export const isFollowupStatus = (v: unknown): v is FollowupStatus =>
  typeof v === 'string' && (FOLLOWUP_STATUSES as readonly string[]).includes(v);

export type FollowupInput = { status: FollowupStatus | null; note: string | null };

/** `{status?, note?}` — at least one; a note is trimmed and capped. */
export function parseFollowupInput(body: unknown): { ok: true; value: FollowupInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid body' };
  const b = body as Record<string, unknown>;
  if (b.status != null && !isFollowupStatus(b.status)) return { ok: false, error: 'status must be open, contacted or closed' };
  if (b.note != null && typeof b.note !== 'string') return { ok: false, error: 'note must be a string' };
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, FOLLOWUP_NOTE_MAX) : null;
  const status = (b.status as FollowupStatus | undefined) ?? null;
  if (!status && !note) return { ok: false, error: 'status or note required' };
  return { ok: true, value: { status, note } };
}

export interface FollowupRow {
  id: string; author_id: string | null; status_from: string | null; status_to: string | null; note: string | null; created_at: string;
}

export function shapeFollowup(r: FollowupRow, names: Map<string, string>) {
  return {
    id: r.id, authorId: r.author_id, authorName: r.author_id ? names.get(r.author_id) ?? null : null,
    statusFrom: r.status_from, statusTo: r.status_to, note: r.note, createdAt: r.created_at,
  };
}
