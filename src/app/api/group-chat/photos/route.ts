import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller, type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { getStreamServerClient, CHANNEL_TYPE } from '@/lib/stream/server';
import { notifyAthlete } from '@/lib/push';
import { groupChatMessageCopy } from '@/lib/notifications/copy';
import { ensureGroupChannel, groupChannelId, groupChatMembers } from '@/lib/group-chat/server';
import { cleanClientId, groupChatTag, groupChatUrl, mayEnter, pushRecipients, GROUP_CHAT_TEXT_MAX } from '@/lib/group-chat/logic';
import {
  CHAT_PHOTO_BUCKET, CHAT_PHOTO_MAX_BYTES, PHOTO_SIGN_TTL_S, isAllowedChatPhotoType, parseMessageIds, photosOf,
} from '@/lib/group-chat/photos';
import { renderChatPhoto, signChatPhotos, storeChatPhoto } from '@/lib/group-chat/photos-server';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * /api/group-chat/photos — photo messages in a group's chat (task 182).
 *
 * POST multipart {groupId, file, text?, id?} → {ok, id, photo}
 *   Re-encodes the photo at three sizes (no camera original, no EXIF), stores it in the private
 *   `group-chat-media` bucket under the group's folder, and posts a message whose attachment
 *   carries only storage paths. The room is pushed like any message (author excluded).
 *
 * GET ?groupId=&messageIds=a,b,c → {photos: {[messageId]: SignedChatPhoto[]}, expiresAt}
 *   Member-gated signed URLs, PHOTO_SIGN_TTL_S long, for messages of THIS group only.
 */

async function gate(caller: VerifiedCaller, groupId: string) {
  if (!groupId) return { error: NextResponse.json({ error: 'groupId required' }, { status: 400, headers: NO_STORE }) };
  const db = createServerClient();
  const members = await groupChatMembers(db, groupId);
  if (!members) return { error: NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE }) };
  if (!mayEnter(caller, members)) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE }) };
  return { db, members };
}

export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.athleteId) return NextResponse.json({ error: 'no athlete identity' }, { status: 403 });
    if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: 'multipart body required' }, { status: 400 });
    const groupId = String(form.get('groupId') || '').trim();
    const g = await gate(caller, groupId);
    if (g.error) return g.error;
    const { db, members } = g;

    const file = form.get('file');
    if (!(file instanceof Blob)) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (!isAllowedChatPhotoType(file.type)) return NextResponse.json({ error: 'unsupported image type' }, { status: 415 });
    if (file.size > CHAT_PHOTO_MAX_BYTES) return NextResponse.json({ error: 'image too large' }, { status: 413 });
    const text = String(form.get('text') ?? '').trim();
    if (text.length > GROUP_CHAT_TEXT_MAX) return NextResponse.json({ error: 'text too long' }, { status: 400 });
    const id = cleanClientId(form.get('id'));

    let rendered;
    try {
      rendered = await renderChatPhoto(Buffer.from(await file.arrayBuffer()));
    } catch {
      return NextResponse.json({ error: 'could not read image' }, { status: 415 });
    }
    const photoId = crypto.randomUUID();
    const photo = await storeChatPhoto(db, groupId, photoId, rendered);
    if (!photo) return NextResponse.json(internalErrorBody(), { status: 500 });

    const stream = getStreamServerClient();
    const { channel } = await ensureGroupChannel(stream, db, groupId, members, caller.athleteId);
    let sentId: string | null = id;
    try {
      const sent = await channel.sendMessage({
        ...(id ? { id } : {}), text, user_id: caller.athleteId, attachments: [photo],
      } as Record<string, unknown>);
      sentId = sent?.message?.id ?? id;
    } catch (err) {
      // An outbox resend of a photo that already landed: the new copy is an orphan, drop it.
      await db.storage.from(CHAT_PHOTO_BUCKET).remove(Object.values(photo.paths)).catch(() => undefined);
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
          copy: (locale) => groupChatMessageCopy(locale, { name: author?.name ?? null, group: group?.name || '', text: text || '📷' }),
          url: groupChatUrl(groupId),
          tag: groupChatTag(groupId),
          category: 'teammates',
        });
      } catch (e) {
        console.error('group chat photo notification failed:', e);
      }
    }));
    return NextResponse.json({ ok: true, id: sentId, photo: { photoId, width: photo.width, height: photo.height } });
  } catch (err: unknown) {
    console.error('POST /api/group-chat/photos error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const { searchParams } = new URL(request.url);
    const groupId = (searchParams.get('groupId') || '').trim();
    const ids = parseMessageIds(searchParams.get('messageIds'));
    const g = await gate(caller, groupId);
    if (g.error) return g.error;
    if (!ids.length) return NextResponse.json({ error: 'messageIds required' }, { status: 400, headers: NO_STORE });

    const stream = getStreamServerClient();
    const cid = `${CHANNEL_TYPE}:${groupChannelId(groupId)}`;
    const found = await Promise.all(ids.map(async (mid) => {
      try {
        const { message } = await stream.getMessage(mid);
        // Another chat's message, a deleted one, or none at all: nothing to sign.
        if (!message || message.cid !== cid || message.type === 'deleted' || message.deleted_at) return [mid, []] as const;
        return [mid, photosOf(message.attachments, groupId)] as const;
      } catch {
        return [mid, []] as const;
      }
    }));
    const all = found.flatMap(([, p]) => p);
    const signed = await signChatPhotos(g.db, all);
    const byPhoto = new Map(signed.map((s) => [s.photoId, s]));
    const photos = Object.fromEntries(found.map(([mid, p]) => [mid, p.map((x) => byPhoto.get(x.photo_id)).filter(Boolean)]));
    const expiresAt = new Date(Date.now() + PHOTO_SIGN_TTL_S * 1000).toISOString();
    return NextResponse.json({ photos, expiresAt }, { headers: NO_STORE });
  } catch (err: unknown) {
    console.error('GET /api/group-chat/photos error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500, headers: NO_STORE });
  }
}
