import type { SupabaseClient } from '@supabase/supabase-js';
import type { StreamChat } from 'stream-chat';
import { packThreadMembers } from '@/lib/packs/thread-server';
import { packChannelId } from '@/lib/packs/server';
import { CHANNEL_TYPE, upsertStreamUsersFromAthletes } from '@/lib/stream/server';

/**
 * The group's channel id. Reuses the b23 pack channel key on purpose: a pack chat that already
 * has history keeps it, and a club group gets the same shape (it is a `groups` row too).
 */
export const groupChannelId = packChannelId;

/** Who sits in the room. Null = no such group. Members, leaders, club coaches and the manager seat. */
export const groupChatMembers = packThreadMembers;

/** Find-or-create the channel and refresh its membership. Idempotent; membership errors are logged, not thrown. */
export async function ensureGroupChannel(
  stream: StreamChat, db: SupabaseClient, groupId: string, members: string[], createdBy: string | null,
) {
  await upsertStreamUsersFromAthletes(stream, db, members);
  const id = groupChannelId(groupId);
  const channel = stream.channel(CHANNEL_TYPE, id, { members, created_by_id: createdBy || members[0] } as Record<string, unknown>);
  try { await channel.create(); } catch { /* exists */ }
  try { await channel.addMembers(members); } catch (err) { console.warn('group chat: addMembers failed', err); }
  return { channel, id, cid: `${CHANNEL_TYPE}:${id}` };
}
