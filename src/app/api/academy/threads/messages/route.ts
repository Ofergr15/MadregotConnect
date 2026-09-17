import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { getStreamServerClient, CHANNEL_TYPE } from '@/lib/stream/server';
import { academyChannelId } from '@/lib/academy/thread';
import { notifyAthlete } from '@/lib/push';
import { academyThreadMessageCopy } from '@/lib/notifications/copy';

export const dynamic = 'force-dynamic';

/** A message longer than this is a document, not a message. */
const TEXT_MAX = 2000;

/**
 * POST /api/academy/threads/messages — say something in a trainee's thread.
 *
 * WHY THIS EXISTS AT ALL, given the client is already connected to Stream and could
 * send directly (and did, until this route): a message sent from the browser to
 * Stream never touches this app, so the app cannot notify anybody about it. Chat that
 * badges nothing and pushes nothing is quieter than the WhatsApp group it replaced,
 * which would make the whole thread a downgrade dressed as an upgrade.
 *
 * The cost is one server hop before the message appears. Realtime delivery is
 * unaffected — Stream still pushes it to everyone watching the channel the moment it
 * lands — so what is actually lost is the optimistic echo, and `ThreadTranscript`
 * already clears its composer optimistically to cover that.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.athleteId) {
      // No athlete row means no Stream identity to speak as. A staff account in that
      // state can read the thread but cannot be a person in it.
      return NextResponse.json({ error: 'no athlete identity' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const athleteId = String(body?.athleteId || '').trim() || caller.athleteId;
    const text = String(body?.text ?? '').trim().slice(0, TEXT_MAX);
    if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

    const supabase = createServerClient();
    const { data: trainee, error } = await supabase
      .from('athletes')
      .select('id, name, is_academy, academy_coach_id')
      .eq('id', athleteId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!trainee) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // The same three-way gate as POST /api/academy/threads, deliberately repeated
    // rather than trusting that the caller opened the thread first: opening and
    // posting are separate requests, and this one writes.
    const isManager = caller.isSuperUser || caller.role === 'admin';
    const isSelf = caller.athleteId === trainee.id;
    const isMentor = caller.athleteId === trainee.academy_coach_id;
    if (!isManager && !isSelf && !isMentor) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const stream = getStreamServerClient();
    const channel = stream.channel(CHANNEL_TYPE, academyChannelId(trainee.id));
    const sent = await channel.sendMessage({
      text,
      user_id: caller.athleteId,
    } as Record<string, unknown>);

    // ── Who hears about it ────────────────────────────────────────────────────
    //
    // NOT everyone in the channel. Every admin is a member (there is no
    // academy-manager role), so notifying all members would push every academy chat
    // message to every admin — and an admin who mutes the club's chat stops seeing
    // the sign-ups too, because it is one toggle.
    //
    // So: staff writing reaches the trainee, and the trainee writing reaches their
    // MENTOR only. The manager already has the ranked inbox, which exists precisely
    // so the third seat can watch twenty threads without twenty pushes.
    //
    // The exception is an unpaired trainee: nobody is assigned, so a message from
    // them would reach nobody at all. That falls back to the admins, because "this
    // one is nobody's job" is exactly when it has to reach somebody.
    const recipients: Array<{ id: string; staff: boolean }> = [];
    if (isSelf) {
      if (trainee.academy_coach_id) {
        recipients.push({ id: trainee.academy_coach_id, staff: true });
      } else {
        const { data: admins } = await supabase
          .from('athletes')
          .select('id')
          .eq('role', 'admin');
        for (const a of admins || []) if (a.id) recipients.push({ id: a.id, staff: true });
      }
    } else {
      recipients.push({ id: trainee.id, staff: false });
    }

    const { data: author } = await supabase
      .from('athletes')
      .select('name')
      .eq('id', caller.athleteId)
      .maybeSingle();

    await Promise.all(recipients
      .filter(r => r.id !== caller.athleteId)
      .map(async (r) => {
        try {
          await notifyAthlete({
            athleteId: r.id,
            kind: 'academy_message',
            actorAthleteId: caller.athleteId,
            copy: (locale) => academyThreadMessageCopy(locale, { name: author?.name ?? null, text }),
            url: '/dashboard/academy',
            // Per THREAD, not per message: a burst of three messages should replace
            // one banner rather than stack three, which is how a chat notification
            // behaves everywhere else on the phone.
            tag: `academy-thread-${trainee.id}`,
            // A trainee's own coach is not "the club's social firehose", so this is
            // 'coach' for them; staff read it as management traffic.
            category: r.staff ? 'management' : 'coach',
          });
        } catch (notifyError) {
          // The message is already in the thread. A failed push must not fail the send.
          console.error('Academy thread notification failed:', notifyError);
        }
      }));

    return NextResponse.json({ ok: true, id: sent?.message?.id ?? null });
  } catch (err: unknown) {
    console.error('POST /api/academy/threads/messages error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
