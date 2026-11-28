import type { SupabaseClient } from '@supabase/supabase-js';
import type { StreamChat } from 'stream-chat';
import { packThreadMembers } from '@/lib/packs/thread-server';
import { packChannelId } from '@/lib/packs/server';
import { CHANNEL_TYPE, getStreamServerClient, upsertStreamUsersFromAthletes } from '@/lib/stream/server';

/**
 * The group's channel id. Reuses the b23 pack channel key on purpose: a pack chat that already
 * has history keeps it, and a club group gets the same shape (it is a `groups` row too).
 */
export const groupChannelId = packChannelId;

/** Who sits in the room. Null = no such group. Members, leaders, active club coaches and the manager seat. */
export const groupChatMembers = packThreadMembers;

/** Who is in the Stream channel but no longer belongs (changed group, left the pack, removed coach). */
export function membersLeaving(current: readonly string[], wanted: readonly string[]): string[] {
  const keep = new Set(wanted);
  return [...new Set(current)].filter((id) => id && !keep.has(id));
}

const MEMBER_PAGE = 100;

/** Every member id Stream holds for the channel, paged. */
async function currentMemberIds(channel: ReturnType<StreamChat['channel']>): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; offset < 5000; offset += MEMBER_PAGE) {
    const { members } = await channel.queryMembers({}, [], { limit: MEMBER_PAGE, offset });
    for (const m of members || []) {
      const uid = m.user_id || m.user?.id;
      if (uid) ids.push(uid);
    }
    if (!members || members.length < MEMBER_PAGE) break;
  }
  return ids;
}

/**
 * Find-or-create the channel and make its membership exactly `members`: adds whoever belongs and
 * removes whoever no longer does (the client reads the channel straight from Stream, so a member
 * left in it keeps reading history and live messages). Same diff as `syncAcademyThreadCoaches`.
 * Idempotent; membership errors are logged, not thrown — the next open or move retries.
 */
export async function ensureGroupChannel(
  stream: StreamChat, db: SupabaseClient, groupId: string, members: string[], createdBy: string | null,
) {
  await upsertStreamUsersFromAthletes(stream, db, members);
  const id = groupChannelId(groupId);
  const channel = stream.channel(CHANNEL_TYPE, id, { members, created_by_id: createdBy || members[0] } as Record<string, unknown>);
  try { await channel.create(); } catch { /* exists */ }
  if (members.length) {
    try { await channel.addMembers(members); } catch (err) { console.warn('group chat: addMembers failed', err); }
  }
  let removed: string[] = [];
  try {
    const leaving = membersLeaving(await currentMemberIds(channel), members);
    if (leaving.length) { await channel.removeMembers(leaving); removed = leaving; }
  } catch (err) {
    console.warn('group chat: removing stale members failed', err);
  }
  return { channel, id, cid: `${CHANNEL_TYPE}:${id}`, removed };
}

/**
 * Re-sync the chats of the groups a membership change touched (a transfer's from + to group).
 * Never throws: the move is already committed, and the next open of the chat re-syncs anyway.
 */
export async function syncGroupChats(db: SupabaseClient, groupIds: Array<string | null | undefined>): Promise<void> {
  const ids = [...new Set(groupIds.filter((g): g is string => !!g))];
  if (!ids.length) return;
  let stream: StreamChat;
  try { stream = getStreamServerClient(); } catch { return; /* Stream not configured */ }
  for (const gid of ids) {
    try {
      const members = await groupChatMembers(db, gid);
      if (members) await ensureGroupChannel(stream, db, gid, members, null);
    } catch (err) {
      console.warn('group chat: membership sync failed', gid, err);
    }
  }
}
