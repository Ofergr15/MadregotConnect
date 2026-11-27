import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { getStreamServerClient, CHANNEL_TYPE } from '@/lib/stream/server';
import { notifyStaff } from '@/lib/notifications/staff';
import { groupChannelId, groupChatMembers } from '@/lib/group-chat/server';
import { mayEnter } from '@/lib/group-chat/logic';
import { moderationUnmigrated, REASONS, NOTE_MAX } from '@/lib/moderation/blocks';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * POST /api/group-chat/report { groupId, messageId, reason, note? } → 201 { id }
 *
 * Report a group-chat message to staff (task 53). Unlike the generic
 * /api/moderation/report, this one checks everything server-side: the reporter
 * must be able to sit in the room, the message must belong to THIS group's
 * channel, and the author is read from Stream (author_verified = true), never
 * from the body. Reports land in `content_reports` with target_type
 * 'group_chat_message' (migration 230 widens the CHECK) and are read by staff
 * only, through GET /api/moderation/report. The author is never told; nothing
 * here is returned to anyone but the reporter (their own report id).
 *
 * 503 until 203 + 230 are applied. One report per (reporter, message); at most
 * REPORTS_PER_HOUR per reporter.
 */
const REPORTS_PER_HOUR = 10;

export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.athleteId) return NextResponse.json({ error: 'no athlete identity' }, { status: 403 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const groupId = String(body?.groupId || '').trim();
    const messageId = String(body?.messageId || '').trim();
    const reason = body?.reason;
    if (!groupId || !messageId || messageId.length > 200) return NextResponse.json({ error: 'groupId and messageId required' }, { status: 400 });
    if (!REASONS.includes(reason as never)) return NextResponse.json({ error: 'invalid reason' }, { status: 400 });
    let note: string | null = null;
    if (body?.note != null) {
      if (typeof body.note !== 'string' || body.note.length > NOTE_MAX) return NextResponse.json({ error: 'invalid note' }, { status: 400 });
      note = body.note.trim() || null;
    }

    const db = createServerClient();
    const members = await groupChatMembers(db, groupId);
    if (!members) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!mayEnter(caller, members)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const stream = getStreamServerClient();
    let authorId: string | null = null;
    try {
      const { message } = await stream.getMessage(messageId);
      if (!message || message.cid !== `${CHANNEL_TYPE}:${groupChannelId(groupId)}`) {
        return NextResponse.json({ error: 'not found' }, { status: 404 });
      }
      authorId = message.user?.id ?? null;
    } catch {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    if (authorId === caller.athleteId) return NextResponse.json({ error: 'cannot report your own message' }, { status: 400 });

    const mine = await db.from('content_reports').select('id')
      .eq('reporter_athlete_id', caller.athleteId).eq('target_type', 'group_chat_message').eq('target_id', messageId).limit(1);
    if (moderationUnmigrated(mine.error)) return unmigrated();
    if (mine.error) return NextResponse.json(internalErrorBody(), { status: 500 });
    if (mine.data?.length) return NextResponse.json({ id: (mine.data[0] as { id: string }).id }, { status: 201 });

    const since = new Date(Date.now() - 3600_000).toISOString();
    const recent = await db.from('content_reports').select('id')
      .eq('reporter_athlete_id', caller.athleteId).gte('created_at', since).limit(REPORTS_PER_HOUR);
    if (recent.error) return NextResponse.json(internalErrorBody(), { status: 500 });
    if ((recent.data?.length ?? 0) >= REPORTS_PER_HOUR) {
      return NextResponse.json({ error: 'too many reports' }, { status: 429, headers: { 'Retry-After': '3600' } });
    }

    const { data, error } = await db.from('content_reports').insert({
      reporter_athlete_id: caller.athleteId,
      target_type: 'group_chat_message',
      target_id: messageId,
      author_athlete_id: authorId,
      author_verified: authorId ? true : null,
      reason,
      note,
      status: 'open',
    }).select('id').single();
    // A CHECK violation on target_type (230 not applied) names content_reports too.
    if (moderationUnmigrated(error)) return unmigrated();
    if (error) return NextResponse.json(internalErrorBody(), { status: 500 });
    const id = (data as { id: string }).id;

    await notifyStaff({
      kind: 'content_report',
      url: `/dashboard/settings?report=${id}`,
      tag: `content-report-group_chat_message-${messageId}`,
      category: 'management',
      actorAthleteId: caller.athleteId,
      copy: (locale) => locale === 'en'
        ? { title: 'Content reported', body: 'A group chat message was reported. Review within 24 hours.' }
        : { title: 'דיווח על תוכן', body: 'דווחה הודעה בצ׳אט קבוצה — לבדוק תוך 24 שעות.' },
    }).catch((e) => console.error('group chat report: staff notify failed', e));
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: unknown) {
    console.error('POST /api/group-chat/report error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}

const unmigrated = () =>
  NextResponse.json({ error: 'moderation not migrated yet (203 + 230)', migrated: false }, { status: 503 });
