import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller, type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { getStreamServerClient, CHANNEL_TYPE } from '@/lib/stream/server';
import { notifyAthlete } from '@/lib/push';
import { groupChatMessageCopy } from '@/lib/notifications/copy';
import { ensureGroupChannel, groupChannelId, groupChatMembers } from '@/lib/group-chat/server';
import {
  cleanClientId, cleanText, groupChatTag, groupChatUrl, mayDelete, mayEdit, mayEnter, pushRecipients,
} from '@/lib/group-chat/logic';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * /api/group-chat/messages — say, edit or delete something in a group's chat.
 *
 * Sending goes through here rather than straight to Stream for the same reason as the academy
 * thread: a message that never touches the app can't push anybody, and a group chat that pushes
 * nothing is quieter than the WhatsApp group it replaces. Realtime delivery is still Stream's.
 */

async function gate(caller: VerifiedCaller, groupId: string) {
  if (!groupId) return { error: NextResponse.json({ error: 'groupId required' }, { status: 400 }) };
  const db = createServerClient();
  const members = await groupChatMembers(db, groupId);
  if (!members) return { error: NextResponse.json({ error: 'not found' }, { status: 404 }) };
  if (!mayEnter(caller, members)) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  return { db, members };
}

/** The message, only if it belongs to this group's channel (an id from another chat is a 404 here). */
async function messageIn(groupId: string, messageId: string) {
  const stream = getStreamServerClient();
  try {
    const { message } = await stream.getMessage(messageId);
    if (!message || message.cid !== `${CHANNEL_TYPE}:${groupChannelId(groupId)}`) return { stream, message: null };
    return { stream, message };
  } catch {
    return { stream, message: null };
  }
}

/** POST {groupId, text, id?, quotedMessageId?} → {ok, id}. A resend of the same client id is a no-op. */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.athleteId) return NextResponse.json({ error: 'no athlete identity' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const groupId = String(body?.groupId || '').trim();
    const text = cleanText(body?.text);
    if (!text) return NextResponse.json({ error: 'text empty or too long' }, { status: 400 });
    const g = await gate(caller, groupId);
    if (g.error) return g.error;
    const { db, members } = g;

    const stream = getStreamServerClient();
    const { channel } = await ensureGroupChannel(stream, db, groupId, members, caller.athleteId);
    const id = cleanClientId(body?.id);
    const quoted = cleanClientId(body?.quotedMessageId);
    // The server client bypasses Stream's permissions, so a quote from another channel (a private
    // academy thread, a pain report) would be copied into the group. Only this chat's messages.
    if (body?.quotedMessageId != null && body.quotedMessageId !== '') {
      if (!quoted || !(await messageIn(groupId, quoted)).message) {
        return NextResponse.json({ error: 'quoted message not in this chat' }, { status: 400 });
      }
    }
    let sentId: string | null = id;
    try {
      const sent = await channel.sendMessage({
        ...(id ? { id } : {}), text, user_id: caller.athleteId, ...(quoted ? { quoted_message_id: quoted } : {}),
      } as Record<string, unknown>);
      sentId = sent?.message?.id ?? id;
    } catch (err) {
      // The outbox resent a message that already landed: it is there, so this is success,
      // and nobody is pushed twice.
      if (id && /already exists/i.test(String(err))) return NextResponse.json({ ok: true, id, duplicate: true });
      throw err;
    }

    const [{ data: author }, { data: group }] = await Promise.all([
      db.from('athletes').select('name').eq('id', caller.athleteId).maybeSingle(),
      db.from('groups').select('name').eq('id', groupId).maybeSingle(),
    ]);
    await Promise.all(pushRecipients(members, caller.athleteId).map(async (rid) => {
      try {
        await notifyAthlete({
          athleteId: rid,
          kind: 'group_chat_message',
          actorAthleteId: caller.athleteId,
          copy: (locale) => groupChatMessageCopy(locale, { name: author?.name ?? null, group: group?.name || '', text }),
          url: groupChatUrl(groupId),
          tag: groupChatTag(groupId),
          category: 'teammates',
        });
      } catch (e) {
        // The message is in the chat already; a failed push must not fail the send.
        console.error('group chat notification failed:', e);
      }
    }));
    return NextResponse.json({ ok: true, id: sentId });
  } catch (err: unknown) {
    console.error('POST /api/group-chat/messages error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}

/** PATCH {groupId, messageId, text} — the author edits their own message. Nobody is pushed. */
export async function PATCH(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const groupId = String(body?.groupId || '').trim();
    const messageId = String(body?.messageId || '').trim();
    const text = cleanText(body?.text);
    if (!messageId || !text) return NextResponse.json({ error: 'messageId and text required' }, { status: 400 });
    const g = await gate(caller, groupId);
    if (g.error) return g.error;
    const { stream, message } = await messageIn(groupId, messageId);
    if (!message) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!mayEdit(caller, message.user?.id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    if (message.type === 'deleted' || message.deleted_at) return NextResponse.json({ error: 'message deleted' }, { status: 409 });
    // Partial: set text only. A full updateMessage({id,text}) wipes the quote and the attachments.
    await stream.partialUpdateMessage(messageId, { set: { text } }, caller.athleteId!);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('PATCH /api/group-chat/messages error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}

/** DELETE ?groupId=&messageId= — the author, or staff. Soft delete: the bubble becomes "deleted" for everyone. */
export async function DELETE(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const { searchParams } = new URL(request.url);
    const groupId = (searchParams.get('groupId') || '').trim();
    const messageId = (searchParams.get('messageId') || '').trim();
    if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 });
    const g = await gate(caller, groupId);
    if (g.error) return g.error;
    const { stream, message } = await messageIn(groupId, messageId);
    if (!message) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!mayDelete(caller, message.user?.id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    await stream.deleteMessage(messageId);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('DELETE /api/group-chat/messages error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}
