import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { getStreamServerClient } from '@/lib/stream/server';
import { ensureAcademyThread } from '@/lib/academy/thread-server';
import { seatFor } from '@/lib/academy/thread';
import { isAcademyManager } from '@/lib/academy/pairing-server';
import { coachIdsOf } from '@/lib/academy/trainee-coaches';
import { packThreadMembers } from '@/lib/packs/thread-server';
import { packChannelId } from '@/lib/packs/server';
import type { VerifiedCaller } from '@/lib/auth/self-or-staff';
import { CHANNEL_TYPE, upsertStreamUsersFromAthletes } from '@/lib/stream/server';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * POST /api/academy/threads — open one trainee's thread.
 *
 * Find-or-create, not create: the client calls this every time it mounts the
 * thread, gets the channel id back, then watches it with the token
 * `/api/run-chat/token` already mints. One token route serves both chats because
 * the academy channel is the same Stream type on a different key.
 *
 * NOT `mayActFor`. That helper lets any staff seat act for any athlete, which is
 * right for club-wide coach views and wrong here: this thread is a private coaching
 * conversation, and "any coach may read any trainee's" is a different product than
 * the one being built. A coach reaches their own trainees; the manager reaches
 * everyone because that is the manager's job; a trainee reaches their own.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const body = await request.json().catch(() => ({}));
    if (body?.kind === 'pack') return openPackThread(caller, String(body?.packId || '').trim());
    const athleteId = String(body?.athleteId || '').trim() || caller.athleteId;
    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: trainee, error } = await supabase
      .from('athletes')
      .select('id, name, is_academy, academy_coach_id')
      .eq('id', athleteId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!trainee) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const isManager = isAcademyManager(caller);
    const isSelf = caller.athleteId === trainee.id;
    // Any of the trainee's coaches — one shared thread for all of them.
    const coachIds = await coachIdsOf(supabase, trainee.id, trainee.academy_coach_id ?? null);
    const isMentor = !!caller.athleteId && coachIds.includes(caller.athleteId);
    if (!isManager && !isSelf && !isMentor) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // An academy thread for a club runner who is not in the academy would be a
    // thread with no mentor in it — an empty room the trainee can post into and
    // nobody is assigned to read. Refused rather than created hopefully.
    if (!trainee.is_academy) {
      return NextResponse.json({ error: 'not an academy trainee', code: 'not_academy' }, { status: 409 });
    }

    const stream = getStreamServerClient();
    const { channelId, cid, members } = await ensureAcademyThread(
      stream,
      supabase,
      trainee.id,
      caller.athleteId,
    );

    return NextResponse.json({
      athleteId: trainee.id,
      name: trainee.name || trainee.id,
      channelId,
      cid,
      members,
      mentorId: coachIds[0] ?? null,
      // All of them, so the transcript seats every coach as "coach" and can name
      // the author when there is more than one.
      mentorIds: coachIds,
      viewerId: caller.athleteId ?? null,
      // The caller's own seat, decided by the same pure function the transcript uses
      // for every other message — so "which bubbles are mine" cannot disagree with
      // "which side did the server think I am on".
      seat: seatFor(caller.athleteId, trainee.id, coachIds),
    });
  } catch (err: unknown) {
    console.error('POST /api/academy/threads error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}

/**
 * `{ kind: 'pack', packId }` — the pack chat (b23, flag academy_pack_chat). Members: the pack's
 * active athletes, its leaders (migration 215), the club coaches and the manager seat. Anyone
 * else is refused. Find-or-create like the trainee thread, membership refreshed on every open.
 */
async function openPackThread(caller: VerifiedCaller, packId: string) {
  if (!packId) return NextResponse.json({ error: 'packId required' }, { status: 400 });
  const supabase = createServerClient();
  const members = await packThreadMembers(supabase, packId);
  if (!members) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!caller.isSuperUser && !(caller.athleteId && members.includes(caller.athleteId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const stream = getStreamServerClient();
  await upsertStreamUsersFromAthletes(stream, supabase, members);
  const id = packChannelId(packId);
  const channel = stream.channel(CHANNEL_TYPE, id, { members, created_by_id: caller.athleteId || members[0] } as Record<string, unknown>);
  try {
    await channel.create();
  } catch {
    // Exists already; membership below.
  }
  try {
    await channel.addMembers(members);
  } catch (err) {
    console.warn('pack thread: addMembers failed', err);
  }
  return NextResponse.json({
    kind: 'pack', packId, channelId: id, cid: `${CHANNEL_TYPE}:${id}`, members, viewerId: caller.athleteId ?? null,
  });
}
