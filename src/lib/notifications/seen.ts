/**
 * The cutoff "unread" is measured from (migration 213).
 *
 * `notifications_seen_at` moves only when the member looks at the inbox; `last_seen_at` moves
 * on every page load (it is "last active"). Before 213 is pasted in the column doesn't exist,
 * so callers select it with a fallback and this falls back to the old cutoff.
 */
export interface SeenRow {
  notifications_seen_at?: string | null;
  last_seen_at?: string | null;
}

export function readCutoff(a: SeenRow): string {
  return a.notifications_seen_at || a.last_seen_at || '1970-01-01';
}

/** PostgREST / Postgres "column does not exist" — the pre-213 shape. */
export function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204';
}
