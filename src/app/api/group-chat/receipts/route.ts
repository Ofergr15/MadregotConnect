import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { getStreamServerClient, CHANNEL_TYPE } from '@/lib/stream/server';
import { groupChannelId, groupChatMembers } from '@/lib/group-chat/server';
import { mayEnter } from '@/lib/group-chat/logic';
import { buildReceipts, type StreamReadState } from '@/lib/group-chat/receipts';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * GET /api/group-chat/receipts?groupId=&messageId= → { groupId, messageId, readBy, notReadBy, streamError }
 *
 * Read receipts for one group chat (task 180). With `messageId`: who in the room has read up to
 * that message (the bubble's "seen by"). Without: everyone's read point. Member-gated like the
 * chat. A staff caller also gets each member's unread count; a member gets `unread: null`.
 *
 * Cost: one Stream channel query with no message bodies (Stream holds the read points), one
 * message lookup when `messageId` is given, and the membership + names reads from our DB.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const { searchParams } = new URL(request.url);
    const groupId = (searchParams.get('groupId') || '').trim();
    const messageId = (searchParams.get('messageId') || '').trim() || null;
    if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400, headers: NO_STORE });

    const db = createServerClient();
    const members = await groupChatMembers(db, groupId);
    if (!members) return NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE });
    if (!mayEnter(caller, members)) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });

    const { data: people } = await db.from('athletes').select('id, name').in('id', members);
    const names = new Map(((people || []) as Array<{ id: string; name: string | null }>).map((p) => [p.id, p.name || '']));
    const withUnread = caller.isStaff || caller.isSuperUser;
    const cid = `${CHANNEL_TYPE}:${groupChannelId(groupId)}`;

    const stream = getStreamServerClient();
    let messageAt: string | null = null;
    let authorId: string | null = null;
    if (messageId) {
      let msg: { cid?: string; created_at?: string | Date; user?: { id?: string } | null } | null = null;
      try { msg = (await stream.getMessage(messageId))?.message ?? null; } catch { msg = null; }
      // A message from another chat is a 404 here, the same as one that doesn't exist.
      if (!msg || msg.cid !== cid) return NextResponse.json({ error: 'message not found' }, { status: 404, headers: NO_STORE });
      messageAt = msg.created_at ? new Date(msg.created_at).toISOString() : null;
      authorId = msg.user?.id ?? null;
    }

    let read: Record<string, StreamReadState | undefined> = {};
    let streamError: string | null = null;
    try {
      const [ch] = await stream.queryChannels(
        { type: CHANNEL_TYPE, id: { $in: [groupChannelId(groupId)] } },
        [{ last_message_at: -1 }],
        { limit: 1, message_limit: 0, state: true, watch: false, ...(caller.athleteId ? { user_id: caller.athleteId } : {}) },
      );
      read = (ch?.state?.read ?? {}) as unknown as Record<string, StreamReadState | undefined>;
    } catch (err) {
      console.error('GET /api/group-chat/receipts — Stream unavailable:', err);
      streamError = 'stream_unavailable';
    }

    const receipts = buildReceipts({ read, members, names, messageAt, authorId, withUnread });
    return NextResponse.json({ groupId, messageId, ...receipts, streamError }, { headers: NO_STORE });
  } catch (err: unknown) {
    console.error('GET /api/group-chat/receipts error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500, headers: NO_STORE });
  }
}
