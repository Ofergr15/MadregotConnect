import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { getStreamServerClient, CHANNEL_TYPE } from '@/lib/stream/server';
import { ensureGroupChannel, groupChannelId, groupChatMembers } from '@/lib/group-chat/server';
import { mayEnter, sortRows, visibleGroupIds, type ChatRow } from '@/lib/group-chat/logic';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * GET /api/group-chat — the caller's chat list: one row per group chat they sit in, with the last
 * message, its time and the caller's own unread count (Stream queried AS the caller, so the count
 * is theirs). Staff see every group; a runner their own group and any pack they lead.
 * A Stream outage still lists the chats (as unused) and says so in `streamError`.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const db = createServerClient();

    const [{ data: groups, error }, { data: me }, { data: led }] = await Promise.all([
      db.from('groups').select('id, name'),
      caller.athleteId ? db.from('athletes').select('group_id').eq('id', caller.athleteId).maybeSingle() : Promise.resolve({ data: null }),
      caller.athleteId ? db.from('pack_leaders').select('pack_id').eq('athlete_id', caller.athleteId) : Promise.resolve({ data: [] }),
    ]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const all = (groups || []) as Array<{ id: string; name: string | null }>;
    const ids = visibleGroupIds(caller, all.map((g) => g.id), (me as { group_id?: string } | null)?.group_id ?? null,
      ((led || []) as Array<{ pack_id: string }>).map((r) => r.pack_id));
    const name = new Map(all.map((g) => [g.id, g.name || g.id]));
    const byChannel = new Map(ids.map((id) => [groupChannelId(id), id]));
    const rows = new Map<string, ChatRow>(ids.map((id) => [id, {
      groupId: id, name: name.get(id) || id, channelId: groupChannelId(id),
      lastText: null, lastAuthorId: null, lastAuthorName: null, lastAt: null, unread: 0, lastReadByOthers: null,
    }]));

    let streamError: string | null = null;
    if (ids.length && caller.athleteId) {
      try {
        const stream = getStreamServerClient();
        const channels = await stream.queryChannels(
          { type: CHANNEL_TYPE, id: { $in: [...byChannel.keys()] } },
          [{ last_message_at: -1 }],
          { limit: 30, message_limit: 1, state: true, user_id: caller.athleteId },
        );
        for (const ch of channels) {
          const gid = ch.id ? byChannel.get(ch.id) : undefined;
          const row = gid ? rows.get(gid) : undefined;
          if (!row) continue;
          const last = [...(ch.state.messages ?? [])].reverse().find((m) => m.type !== 'deleted' && !m.parent_id);
          let unread = 0;
          try { unread = ch.countUnread(); } catch { unread = 0; }
          const lastAt = last?.created_at ? new Date(last.created_at as string | Date).toISOString() : null;
          let readByOthers: boolean | null = null;
          if (last && last.user?.id === caller.athleteId && lastAt) {
            const reads = Object.entries(ch.state.read ?? {}).filter(([uid]) => uid !== caller.athleteId);
            readByOthers = reads.some(([, r]) => r?.last_read && new Date(r.last_read).getTime() >= Date.parse(lastAt));
          }
          rows.set(row.groupId, {
            ...row, lastText: last?.text ?? null, lastAuthorId: last?.user?.id ?? null,
            lastAuthorName: (last?.user?.name as string | undefined) ?? null, lastAt, unread, lastReadByOthers: readByOthers,
          });
        }
      } catch (err) {
        // Never the raw error: Stream's messages can carry member ids. The detail is in the log.
        streamError = 'chat service unavailable';
        console.error('GET /api/group-chat — Stream unavailable:', err);
      }
    }

    const list = sortRows([...rows.values()]);
    return NextResponse.json({ chats: list, unreadTotal: list.reduce((s, r) => s + r.unread, 0), streamError });
  } catch (err: unknown) {
    console.error('GET /api/group-chat error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}

/**
 * POST /api/group-chat {groupId} — open one group's chat: membership check, find-or-create the
 * channel, refresh its members. Returns what the client needs to read it with its Stream token
 * (POST /api/run-chat/token): `{groupId, name, channelId, cid, members, viewerId}`.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const groupId = String(body?.groupId || '').trim();
    if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 });
    const db = createServerClient();
    const members = await groupChatMembers(db, groupId);
    if (!members) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!mayEnter(caller, members)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const { data: g } = await db.from('groups').select('name').eq('id', groupId).maybeSingle();
    const { id, cid } = await ensureGroupChannel(getStreamServerClient(), db, groupId, members, caller.athleteId);
    return NextResponse.json({ groupId, name: g?.name || groupId, channelId: id, cid, members, viewerId: caller.athleteId ?? null });
  } catch (err: unknown) {
    console.error('POST /api/group-chat error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}
