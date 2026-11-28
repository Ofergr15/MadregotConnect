import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { getStreamServerClient, CHANNEL_TYPE } from '@/lib/stream/server';
import { groupChannelId, visibleChatGroups } from '@/lib/group-chat/server';
import { unreadByGroup, type UnreadChannel } from '@/lib/group-chat/logic';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const STREAM_PAGE = 30;

/**
 * GET /api/group-chat/unread → { byGroup: { [groupId]: n }, total, streamError } — the caller's
 * unread count in every group chat they sit in, from ONE Stream query (task 87). No message
 * bodies, so the tab badge can poll it cheaply. Counts are the caller's own (queried as them).
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const { error, groups } = await visibleChatGroups(createServerClient(), caller);
    if (error) return NextResponse.json(internalErrorBody(), { status: 500 });
    const byChannel = new Map(groups.map((g) => [groupChannelId(g.id), g.id]));
    if (!groups.length || !caller.athleteId) {
      return NextResponse.json(unreadByGroup([], byChannel, caller.athleteId ?? ''), { headers: NO_STORE });
    }
    try {
      // Stream returns at most 30 channels per query: one query for any member (own group +
      // led packs), a few for staff who sit in every group.
      const ids = [...byChannel.keys()];
      const uid = caller.athleteId;
      const client = getStreamServerClient();
      const pages = await Promise.all(
        Array.from({ length: Math.ceil(ids.length / STREAM_PAGE) }, (_, i) => client.queryChannels(
          { type: CHANNEL_TYPE, id: { $in: ids.slice(i * STREAM_PAGE, (i + 1) * STREAM_PAGE) } },
          [{ last_message_at: -1 }],
          { limit: STREAM_PAGE, message_limit: 0, state: true, watch: false, user_id: uid },
        )),
      );
      const channels = pages.flat();
      return NextResponse.json(
        { ...unreadByGroup(channels as unknown as UnreadChannel[], byChannel, caller.athleteId), streamError: null },
        { headers: NO_STORE },
      );
    } catch (err) {
      console.error('GET /api/group-chat/unread — Stream unavailable:', err);
      return NextResponse.json({ ...unreadByGroup([], byChannel, caller.athleteId), streamError: 'stream_unavailable' }, { headers: NO_STORE });
    }
  } catch (err: unknown) {
    console.error('GET /api/group-chat/unread error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}
