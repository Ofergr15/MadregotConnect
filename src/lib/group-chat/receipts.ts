// Group chat read receipts (task 180): who has read up to a message, and each member's own
// unread count. Pure — the Stream read and the names lookup live in the route.
//
// Stream keeps one read point per channel member (`state.read[userId]`): the time they last
// read, the message it was and how many arrived since. That is the whole receipt; nothing here
// is stored in our DB, so the per-member answer costs one Stream query with no message bodies.

/** One member's read point as Stream returns it (state.read[userId]). */
export interface StreamReadState {
  last_read?: string | Date | null;
  last_read_message_id?: string | null;
  unread_messages?: number | null;
}

export interface ReceiptRow {
  athleteId: string;
  name: string;
  lastReadAt: string | null;
  /** Only filled for a staff caller — a member sees who read, not how far behind a teammate is. */
  unread: number | null;
}

export interface Receipts {
  /** Members whose read point is at or after the message (or anyone with a read point when no message is asked about). */
  readBy: ReceiptRow[];
  /** Members still before it. The message's own author is never in either list. */
  notReadBy: ReceiptRow[];
}

const iso = (v: string | Date | null | undefined): string | null => {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/**
 * Split the room into read / not-yet-read for one message.
 *
 * - `messageAt` null → "read anything at all": readBy = everyone with a read point.
 * - The author of the message is left out (you don't receipt your own words).
 * - Only ids in `members` count: Stream may still hold a read point for someone who left.
 * - readBy newest-first (who saw it last on top), notReadBy by name.
 */
export function buildReceipts(input: {
  read: Record<string, StreamReadState | undefined> | null | undefined;
  members: readonly string[];
  names: ReadonlyMap<string, string>;
  messageAt: string | null;
  authorId?: string | null;
  withUnread: boolean;
}): Receipts {
  const at = input.messageAt ? Date.parse(input.messageAt) : null;
  const readBy: ReceiptRow[] = [];
  const notReadBy: ReceiptRow[] = [];
  for (const id of new Set(input.members)) {
    if (!id || id === input.authorId) continue;
    const r = input.read?.[id];
    const lastReadAt = iso(r?.last_read);
    const n = r?.unread_messages;
    const row: ReceiptRow = {
      athleteId: id,
      name: input.names.get(id) || '',
      lastReadAt,
      unread: input.withUnread ? (typeof n === 'number' && n > 0 ? Math.floor(n) : 0) : null,
    };
    const seen = lastReadAt != null && (at == null || Date.parse(lastReadAt) >= at);
    (seen ? readBy : notReadBy).push(row);
  }
  readBy.sort((a, b) => Date.parse(b.lastReadAt!) - Date.parse(a.lastReadAt!));
  notReadBy.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return { readBy, notReadBy };
}
