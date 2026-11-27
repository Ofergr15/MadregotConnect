/**
 * The admin sign-up queue's decision rules, kept pure so every state is testable
 * without a database (task 62).
 *
 * A `signup_requests` row is in one of four states (migrations 083 + 089):
 *
 *   pending  — waiting for an approver. The only state that accepts a decision.
 *   approved — an athlete row exists and a /join link was mailed. FINAL here:
 *              undoing it would mean un-sending an email and deleting a member
 *              row that may already have a login, so this API refuses.
 *   rejected — turned down, with a reason. Undoable for UNDO_WINDOW_MS after
 *              `rejected_at`, by any approver, back to pending.
 *   member   — a record that the address already belonged to a member. Not a task.
 *
 * Approval itself still goes through POST /api/admin/registrations/approve — it
 * creates the athlete row and sends the mail, and two routes doing that would drift.
 */

export const UNDO_WINDOW_MS = 10 * 60 * 1000;

/** Fixed reason codes. The screen shows Hebrew labels; the DB stores the code. */
export const REJECT_REASONS = ['spam', 'duplicate', 'not_in_club', 'wrong_details', 'other'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const REJECT_REASON_LABELS_HE: Record<RejectReason, string> = {
  spam: 'ספאם',
  duplicate: 'בקשה כפולה',
  not_in_club: 'לא חבר/ה במועדון',
  wrong_details: 'פרטים שגויים',
  other: 'אחר',
};

/** Free-text note is optional and short: it is read on a phone, never mailed. */
export const MAX_NOTE_LENGTH = 280;

export type SignupStatus = 'pending' | 'approved' | 'rejected' | 'member';

export interface SignupRow {
  id: string;
  status: SignupStatus | string;
  rejected_at?: string | null;
}

export type Decision =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; status: number; error: string };

export function isRejectReason(v: unknown): v is RejectReason {
  return typeof v === 'string' && (REJECT_REASONS as readonly string[]).includes(v);
}

/** Trim, collapse whitespace, cap length. Returns null for an empty note. */
export function cleanNote(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return [...s].slice(0, MAX_NOTE_LENGTH).join('');
}

/** When an undo of this row stops being possible, or null if it never is. */
export function undoDeadline(row: SignupRow): Date | null {
  if (row.status !== 'rejected' || !row.rejected_at) return null;
  const t = Date.parse(row.rejected_at);
  if (!Number.isFinite(t)) return null;
  return new Date(t + UNDO_WINDOW_MS);
}

export function canUndo(row: SignupRow, now: Date): boolean {
  const d = undoDeadline(row);
  return !!d && now.getTime() < d.getTime();
}

export function decideReject(
  row: SignupRow,
  input: { reason: unknown; note?: unknown },
  by: string | null,
  now: Date,
): Decision {
  if (row.status !== 'pending') {
    return { ok: false, status: 409, error: `already ${row.status}` };
  }
  if (!isRejectReason(input.reason)) {
    return { ok: false, status: 400, error: `reason must be one of ${REJECT_REASONS.join(', ')}` };
  }
  const note = cleanNote(input.note);
  if (input.reason === 'other' && !note) {
    return { ok: false, status: 400, error: "reason 'other' needs a note" };
  }
  return {
    ok: true,
    patch: {
      status: 'rejected',
      rejected_at: now.toISOString(),
      rejected_by: by,
      decision_reason: input.reason,
      decision_note: note,
    },
  };
}

export function decideUndo(row: SignupRow, now: Date): Decision {
  if (row.status === 'pending') return { ok: false, status: 409, error: 'already pending' };
  if (row.status === 'approved') {
    return { ok: false, status: 409, error: 'an approval cannot be undone (the join link was already mailed)' };
  }
  if (row.status !== 'rejected') return { ok: false, status: 409, error: `cannot undo ${row.status}` };
  if (!canUndo(row, now)) return { ok: false, status: 409, error: 'undo window has passed' };
  return {
    ok: true,
    patch: { status: 'pending', rejected_at: null, rejected_by: null, decision_reason: null, decision_note: null },
  };
}

/** Drop the two migration-240 columns from a patch, for a DB that hasn't run it. */
export function withoutReasonColumns(patch: Record<string, unknown>): Record<string, unknown> {
  const { decision_reason: _r, decision_note: _n, ...rest } = patch;
  return rest;
}
