import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { getStreamServerClient, CHANNEL_TYPE } from '@/lib/stream/server';
import { academyChannelId } from '@/lib/academy/thread';
import { isAcademyManager } from '@/lib/academy/pairing-server';
import { coachIdsOf } from '@/lib/academy/trainee-coaches';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const CHANNEL_PREFIX = 'academy-';

/**
 * POST /api/academy/threads/read — "I have read this thread", for a client that does not
 * connect to Stream itself (native). The web panel calls `channel.markRead()` over its own
 * Stream connection; this is the same write, made server-side.
 *
 * Body: `{ athleteId }` (the trainee whose thread, as the messages routes name it) or
 * `{ threadId }` (the Stream channel id, `academy-<athleteId>`). Either only NAMES THE
 * THREAD. Whose read is marked is never taken from the body: it is always the verified
 * caller's own Stream user — marking somebody else's read would forge a ✓✓.
 *
 * Gate: the same three-way rule as GET/POST /messages — the trainee, any of their
 * coaches, or an academy manager. 403 otherwise. Idempotent (Stream's markRead is).
 *
 * The coach's ✓✓ (`seenByTrainee` on /inbox) already comes from the channel's own read
 * state, so the trainee calling this is what flips it; nothing is stored here.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.athleteId) {
      return NextResponse.json({ error: 'no athlete identity' }, { status: 403, headers: NO_STORE });
    }

    const body = await request.json().catch(() => ({}));
    const threadId = typeof body?.threadId === 'string' ? body.threadId.trim() : '';
    const athleteId = threadId.startsWith(CHANNEL_PREFIX)
      ? threadId.slice(CHANNEL_PREFIX.length)
      : (typeof body?.athleteId === 'string' ? body.athleteId.trim() : '') || (threadId ? '' : caller.athleteId);
    if (!athleteId) return NextResponse.json({ error: 'athleteId or threadId required' }, { status: 400, headers: NO_STORE });

    const supabase = createServerClient();
    const { data: trainee, error } = await supabase
      .from('athletes')
      .select('id, academy_coach_id')
      .eq('id', athleteId)
      .maybeSingle();
    if (error) { console.error('[api/academy/threads/read]', error); return NextResponse.json({ error: 'failed' }, { status: 500, headers: NO_STORE }); }
    if (!trainee) return NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE });

    const isSelf = caller.athleteId === trainee.id;
    const coachIds = await coachIdsOf(supabase, trainee.id, trainee.academy_coach_id ?? null);
    const isMentor = coachIds.includes(caller.athleteId);
    if (!isAcademyManager(caller) && !isSelf && !isMentor) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
    }

    const stream = getStreamServerClient();
    const channel = stream.channel(CHANNEL_TYPE, academyChannelId(trainee.id));
    await channel.markRead({ user_id: caller.athleteId });

    return NextResponse.json(
      { ok: true, threadId: academyChannelId(trainee.id), readerId: caller.athleteId },
      { headers: NO_STORE },
    );
  } catch (err: unknown) {
    console.error('POST /api/academy/threads/read error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500, headers: NO_STORE });
  }
}
