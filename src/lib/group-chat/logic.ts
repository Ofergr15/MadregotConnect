// Group chat (b26): one chat per `groups` row — a club group 1/2/3 and an academy pack are the same
// table, so the group is the parameter and nothing here knows which kind it is. Pure rules only;
// the Stream and DB reads live in ./server.ts.

/** A message longer than this is a document, not a message. Same cap as the academy thread. */
export const GROUP_CHAT_TEXT_MAX = 2000;

/** Client-chosen message id, so an outbox resend lands once. Stream allows [A-Za-z0-9_-]. */
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function cleanText(raw: unknown): string | null {
  const t = String(raw ?? '').trim();
  if (!t || t.length > GROUP_CHAT_TEXT_MAX) return null;
  return t;
}

export function cleanClientId(raw: unknown): string | null {
  return typeof raw === 'string' && CLIENT_ID.test(raw) ? raw : null;
}

/**
 * Everyone in the room hears a new message except its author. Staff are members too (the
 * coaches and the manager seat), and they are not filtered here: chat goes out under the
 * `teammates` category, which is already default-off for staff (STAFF_QUIET_CATEGORIES), so a
 * coach who wants the pings turns it on and one who doesn't never gets the firehose.
 */
export function pushRecipients(members: readonly string[], authorId: string): string[] {
  return [...new Set(members)].filter((id) => id && id !== authorId);
}

export interface ChatActor { athleteId: string | null; isStaff: boolean; isSuperUser: boolean }

/** Only the author rewrites their own words — staff moderating remove, they don't put words in someone's mouth. */
export function mayEdit(actor: ChatActor, authorId: string | null | undefined): boolean {
  return !!actor.athleteId && actor.athleteId === authorId;
}

/** The author, or staff (the WhatsApp group admin's "delete for everyone"). */
export function mayDelete(actor: ChatActor, authorId: string | null | undefined): boolean {
  return mayEdit(actor, authorId) || actor.isStaff || actor.isSuperUser;
}

/** May this caller sit in this group's chat: a member of the room, or a super user. */
export function mayEnter(actor: ChatActor, members: readonly string[] | null): boolean {
  if (!members) return false;
  return actor.isSuperUser || (!!actor.athleteId && members.includes(actor.athleteId));
}

/** Which group chats a caller's list shows: staff see every group, everyone else their own + led ones. */
export function visibleGroupIds(
  actor: ChatActor,
  allGroupIds: readonly string[],
  ownGroupId: string | null,
  ledGroupIds: readonly string[],
): string[] {
  if (actor.isStaff || actor.isSuperUser) return [...allGroupIds];
  const mine = new Set([...(ownGroupId ? [ownGroupId] : []), ...ledGroupIds]);
  return allGroupIds.filter((id) => mine.has(id));
}

export interface ChatRow {
  groupId: string;
  name: string;
  channelId: string;
  lastText: string | null;
  lastAuthorId: string | null;
  lastAuthorName: string | null;
  lastAt: string | null;
  unread: number;
  /** Your own last message was read by someone else (the list's ✓✓). Null when the last isn't yours. */
  lastReadByOthers: boolean | null;
}

/** Newest conversation first; never-used chats last, by name. */
export function sortRows(rows: ChatRow[]): ChatRow[] {
  return [...rows].sort((a, b) => {
    if (a.lastAt && b.lastAt) return Date.parse(b.lastAt) - Date.parse(a.lastAt);
    if (a.lastAt) return -1;
    if (b.lastAt) return 1;
    return a.name.localeCompare(b.name, 'he');
  });
}

/** Push banner tag: one per group, so a burst replaces one banner instead of stacking. */
export const groupChatTag = (groupId: string) => `group-chat-${groupId}`;
/** Where the push lands: the native app and the PWA both route /chat/<groupId>. */
export const groupChatUrl = (groupId: string) => `/chat/${encodeURIComponent(groupId)}`;

/** What Stream returns per channel that the unread count needs (task 87). */
export interface UnreadChannel {
  id?: string;
  state: { read?: Record<string, { unread_messages?: number } | undefined> };
  countUnread?: () => number;
}

/**
 * Unread per group for one member, from ONE Stream query's channels. Prefers the server's own
 * per-user counter (`read[uid].unread_messages`, present even with message_limit 0) and falls
 * back to counting loaded messages. Groups Stream didn't return (no channel yet) are 0.
 */
export function unreadByGroup(
  channels: UnreadChannel[], groupOfChannel: Map<string, string>, userId: string,
): { byGroup: Record<string, number>; total: number } {
  const byGroup: Record<string, number> = Object.fromEntries([...groupOfChannel.values()].map((g) => [g, 0]));
  for (const ch of channels) {
    const gid = ch.id ? groupOfChannel.get(ch.id) : undefined;
    if (!gid) continue;
    let n = ch.state.read?.[userId]?.unread_messages;
    if (typeof n !== 'number') { try { n = ch.countUnread?.() ?? 0; } catch { n = 0; } }
    byGroup[gid] = Math.max(0, Math.floor(n || 0));
  }
  return { byGroup, total: Object.values(byGroup).reduce((s, v) => s + v, 0) };
}
