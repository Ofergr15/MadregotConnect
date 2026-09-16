import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { getStreamServerClient } from '@/lib/stream/server';
import { ensureAcademyThread } from '@/lib/academy/thread-server';
import { seatFor } from '@/lib/academy/thread';

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

    const isManager = caller.isSuperUser || caller.role === 'admin';
    const isSelf = caller.athleteId === trainee.id;
    const isMentor = !!caller.athleteId && caller.athleteId === trainee.academy_coach_id;
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
      mentorId: trainee.academy_coach_id ?? null,
      // The caller's own seat, decided by the same pure function the transcript uses
      // for every other message — so "which bubbles are mine" cannot disagree with
      // "which side did the server think I am on".
      seat: seatFor(caller.athleteId, trainee.id, trainee.academy_coach_id ?? null),
    });
  } catch (err: unknown) {
    console.error('POST /api/academy/threads error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
