import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { isSuperUser } from '@/lib/constants';
import { subscriptionsForAthletes, sendPushToSubscriptions } from '@/lib/push';

export const dynamic = 'force-dynamic';

type SupabaseServer = ReturnType<typeof createServerClient>;

/** Resolves whether `email` may act on this feedback thread, and as which
 * side — the owning athlete, or any staff member (never both, an athlete
 * can't reply to their own feedback as "staff" even if they're also a coach
 * elsewhere in the club). */
async function resolveSide(
  supabase: SupabaseServer,
  email: string,
  ownerAthleteId: string,
): Promise<{ side: 'athlete' | 'coach'; senderAthleteId: string } | null> {
  if (!email) return null;
  if (isSuperUser(email)) {
    const { data } = await supabase.from('athletes').select('id').eq('email', email).maybeSingle();
    if (data) return { side: 'coach', senderAthleteId: (data as { id: string }).id };
  }
  const { data: caller } = await supabase.from('athletes').select('id, role').eq('email', email).maybeSingle();
  if (!caller) return null;
  const row = caller as { id: string; role?: string };
  if (row.id === ownerAthleteId) return { side: 'athlete', senderAthleteId: row.id };
  if (['coach', 'admin', 'academy_coach'].includes(row.role || '')) return { side: 'coach', senderAthleteId: row.id };
  return null;
}

// GET /api/workout-feedback/[id]/messages?viewerEmail=…
// Roadmap #1, Personal Chat & Feedback System — the thread for one feedback
// row (see migration 063). Marks the viewer's side as caught-up to "now" as
// a side effect, same as the old single-reply PATCH's reply_seen_at did.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const viewerEmail = (searchParams.get('viewerEmail') || '').toLowerCase().trim();

    const supabase = createServerClient();
    const { data: fb, error: fbError } = await supabase
      .from('workout_feedback')
      .select('id, athlete_id')
      .eq('id', id)
      .maybeSingle();
    if (fbError || !fb) return NextResponse.json({ error: 'feedback not found' }, { status: 404 });

    const side = await resolveSide(supabase, viewerEmail, fb.athlete_id);
    if (!side) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { data: rows, error } = await supabase
      .from('workout_feedback_messages')
      .select('id, sender_athlete_id, body, created_at')
      .eq('feedback_id', id)
      .order('created_at', { ascending: true });
    if (error) {
      if ((error as { code?: string }).code === 'PGRST205') return NextResponse.json({ messages: [], viewerSide: side.side });
      throw error;
    }

    const senderIds = Array.from(new Set((rows || []).map((r: { sender_athlete_id: string }) => r.sender_athlete_id)));
    const { data: senderRows } = senderIds.length
      ? await supabase.from('athletes').select('id, name, avatar_url').in('id', senderIds)
      : { data: [] };
    const senderById = new Map(
      ((senderRows || []) as Array<{ id: string; name: string; avatar_url: string | null }>).map((s) => [s.id, s]),
    );

    const messages = (rows || []).map((r: { id: string; sender_athlete_id: string; body: string; created_at: string }) => {
      const sender = senderById.get(r.sender_athlete_id);
      return {
        id: r.id,
        body: r.body,
        createdAt: r.created_at,
        isMine: r.sender_athlete_id === side.senderAthleteId,
        senderName: sender?.name || null,
        senderAvatarUrl: sender?.avatar_url || null,
      };
    });

    // Mark this side caught-up. Best-effort — a failed stamp shouldn't hide
    // the thread the viewer just successfully loaded.
    try {
      const col = side.side === 'athlete' ? 'athlete_last_read_at' : 'coach_last_read_at';
      await supabase.from('workout_feedback').update({ [col]: new Date().toISOString() }).eq('id', id);
    } catch { /* best-effort */ }

    return NextResponse.json({ messages, viewerSide: side.side });
  } catch (err) {
    console.error('Failed to fetch feedback thread:', err);
    return NextResponse.json({ error: 'Failed to fetch thread' }, { status: 500 });
  }
}

// POST /api/workout-feedback/[id]/messages { senderEmail, body }
// Either side may post — the owning athlete, or any staff member. Pushes the
// OTHER side (category 'coach' either direction, matching the existing
// single-reply push's category so notification prefs already cover it).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { senderEmail, body } = await request.json();
    const trimmed = typeof body === 'string' ? body.trim().slice(0, 2000) : '';
    if (!trimmed) return NextResponse.json({ error: 'body is required' }, { status: 400 });

    const supabase = createServerClient();
    const { data: fb, error: fbError } = await supabase
      .from('workout_feedback')
      .select('id, athlete_id, garmin_activity_id')
      .eq('id', id)
      .maybeSingle();
    if (fbError || !fb) return NextResponse.json({ error: 'feedback not found' }, { status: 404 });

    const email = (senderEmail || '').toLowerCase().trim();
    const side = await resolveSide(supabase, email, fb.athlete_id);
    if (!side) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const { data: message, error } = await supabase
      .from('workout_feedback_messages')
      .insert({ feedback_id: id, sender_athlete_id: side.senderAthleteId, body: trimmed })
      .select('id, created_at')
      .single();
    if (error) throw error;

    // The sender is caught up on their own message by definition.
    const myCol = side.side === 'athlete' ? 'athlete_last_read_at' : 'coach_last_read_at';
    await supabase.from('workout_feedback').update({ [myCol]: message.created_at }).eq('id', id);

    // Push the OTHER side. Athlete → any staff subscribed near this feedback
    // isn't tracked per-thread, so (matching the old single-reply flow's own
    // scope) this only pushes staff→athlete; an athlete's new message just
    // surfaces next time staff open Workout Feedback, same as a fresh
    // submission already does.
    if (side.side === 'coach') {
      try {
        const subs = await subscriptionsForAthletes([fb.athlete_id]);
        if (subs.length) {
          const { data: senderRow } = await supabase.from('athletes').select('name, avatar_url').eq('id', side.senderAthleteId).maybeSingle();
          const senderName = (senderRow as { name?: string } | null)?.name?.trim() || '';
          const senderAvatarUrl = (senderRow as { avatar_url?: string } | null)?.avatar_url?.trim() || '';
          const url = fb.garmin_activity_id ? `/dashboard/feedback?activity=${fb.garmin_activity_id}` : '/dashboard';
          await sendPushToSubscriptions(subs, {
            title: senderName ? `💬 תשובה מ${senderName}` : '💬 תשובה מהמאמן',
            body: trimmed.slice(0, 120),
            url,
            tag: `coach-reply-${id}`,
            category: 'coach',
            ...(senderAvatarUrl ? { icon: senderAvatarUrl } : {}),
          });
        }
      } catch { /* push optional */ }
    }

    return NextResponse.json({ id: message.id, createdAt: message.created_at });
  } catch (err) {
    console.error('Failed to post feedback message:', err);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
