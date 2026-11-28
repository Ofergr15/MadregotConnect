import type { SupabaseClient } from '@supabase/supabase-js';
import type { StreamChat } from 'stream-chat';
import { packThreadMembers } from '@/lib/packs/thread-server';
import { packChannelId } from '@/lib/packs/server';
import { CHANNEL_TYPE, upsertStreamUsersFromAthletes } from '@/lib/stream/server';
import { visibleGroupIds } from './logic';
import type { VerifiedCaller } from '@/lib/auth/self-or-staff';

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

/**
 * The group chats this caller sits in, with names: staff every group, a runner their own group and
 * any pack they lead. One place for the list GET /api/group-chat and GET …/unread both answer.
 */
export async function visibleChatGroups(
  db: SupabaseClient, caller: Pick<VerifiedCaller, 'athleteId' | 'isStaff' | 'isSuperUser'>,
): Promise<{ error: { message: string } | null; groups: Array<{ id: string; name: string }> }> {
  const [{ data: groups, error }, { data: me }, { data: led }] = await Promise.all([
    db.from('groups').select('id, name'),
    caller.athleteId ? db.from('athletes').select('group_id').eq('id', caller.athleteId).maybeSingle() : Promise.resolve({ data: null }),
    caller.athleteId ? db.from('pack_leaders').select('pack_id').eq('athlete_id', caller.athleteId) : Promise.resolve({ data: [] }),
  ]);
  if (error) return { error, groups: [] };
  const all = (groups || []) as Array<{ id: string; name: string | null }>;
  const ids = visibleGroupIds(caller, all.map((g) => g.id), (me as { group_id?: string } | null)?.group_id ?? null,
    ((led || []) as Array<{ pack_id: string }>).map((r) => r.pack_id));
  const name = new Map(all.map((g) => [g.id, g.name || g.id]));
  return { error: null, groups: ids.map((id) => ({ id, name: name.get(id) || id })) };
}
