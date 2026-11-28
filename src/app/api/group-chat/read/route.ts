import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { getStreamServerClient, CHANNEL_TYPE } from '@/lib/stream/server';
import { groupChannelId, groupChatMembers } from '@/lib/group-chat/server';
import { mayEnter } from '@/lib/group-chat/logic';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * POST /api/group-chat/read { groupId } → { ok, groupId, unread: 0 } — mark the caller's read
 * point at the newest message (task 87). For the native app, which doesn't hold a Stream
 * connection on every screen. Member-gated like the chat itself. Idempotent: a repeat, or a
 * group whose channel was never created (nothing to read), is the same 200. An admin viewing
 * as someone else (viewingAsBy) doesn't move that person's read point.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.athleteId) return NextResponse.json({ error: 'no athlete identity' }, { status: 403, headers: NO_STORE });
    const body = await request.json().catch(() => ({}));
    const groupId = typeof body?.groupId === 'string' ? body.groupId.trim() : '';
    if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400, headers: NO_STORE });
    const members = await groupChatMembers(createServerClient(), groupId);
    if (!members) return NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE });
    if (!mayEnter(caller, members)) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });

    if (!caller.viewingAsBy) {
      try {
        await getStreamServerClient().channel(CHANNEL_TYPE, groupChannelId(groupId)).markRead({ user_id: caller.athleteId });
      } catch (err) {
        // No channel yet (nobody has written) or the caller isn't a Stream member yet: there is
        // nothing unread, so the answer is the same. Logged, not surfaced.
        console.warn('group-chat read: markRead skipped', String(err));
      }
    }
    return NextResponse.json({ ok: true, groupId, unread: 0 }, { headers: NO_STORE });
  } catch (err: unknown) {
    console.error('POST /api/group-chat/read error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500, headers: NO_STORE });
  }
}
