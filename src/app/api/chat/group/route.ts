import { NextRequest, NextResponse } from 'next/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';
import { getStreamServerClient } from '@/lib/stream/server';
import { CHANNEL_TYPE } from '@/lib/stream/constants';
import { isGroupChannelId, parseGroupEdit } from '@/lib/stream/group-edit';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/chat/group — staff renames a group chat / edits its description or image.
 * Identity comes from the Supabase JWT (requireStaff); the body only names the channel and
 * the fields. Group channels only (pack chats, run chats) — DMs and 1:1 threads are refused.
 * Body: { channelId, name?, description?, image? }
 */
export async function PATCH(req: NextRequest) {
  try {
    const { denied, caller } = await requireStaffCaller(req);
    if (denied) return denied;
    // Gated rollout: native_chat_group_edit is off by default and the server enforces it, not just the app.
    if (!(await isFeatureEnabled('native_chat_group_edit', caller.athleteId).catch(() => false))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
    }
    const channelId = (body as Record<string, unknown> | null)?.channelId;
    if (!isGroupChannelId(channelId)) {
      return NextResponse.json({ error: 'not a group channel' }, { status: 400 });
    }
    const parsed = parseGroupEdit(body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const stream = getStreamServerClient();
    const channel = stream.channel(CHANNEL_TYPE, channelId);
    try {
      await channel.updatePartial({ set: parsed.patch as Record<string, unknown> });
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (/does not exist|not found/i.test(msg) || err?.status === 404) {
        return NextResponse.json({ error: 'channel not found' }, { status: 404 });
      }
      throw err;
    }
    return NextResponse.json({ ok: true, channelId, ...parsed.patch });
  } catch (error: any) {
    console.error('chat/group PATCH failed', error);
    return NextResponse.json({ error: error.message || 'update failed' }, { status: 500 });
  }
}
