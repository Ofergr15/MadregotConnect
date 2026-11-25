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
  created_at?: string | null;
}

/**
 * Post-213 (the key is present, even as null) a null `notifications_seen_at` means "never opened the
 * inbox" — 213 backfilled everyone who existed, so that is a member who joined after the paste. Their
 * cutoff is when they joined, NOT `last_seen_at`: falling back to "last active" is the very bug 213
 * fixed, and it never healed because the page posts /seen only when it has rows (QA 25.11).
 * Pre-213 (key absent, the fallback select) keeps the old `last_seen_at` cutoff.
 */
export function readCutoff(a: SeenRow): string {
  if ('notifications_seen_at' in a) return a.notifications_seen_at || a.created_at || '1970-01-01';
  return a.last_seen_at || '1970-01-01';
}

/** PostgREST / Postgres "column does not exist" — the pre-213 shape. */
export function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204';
}
