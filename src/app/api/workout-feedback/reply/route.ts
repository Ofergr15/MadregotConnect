import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { notifyAthlete } from '@/lib/push';

export const dynamic = 'force-dynamic';

// POST /api/workout-feedback/reply { feedbackId, reply }
// A coach writes back on a post-workout feedback row. Staff-only (coach/admin/
// academy_coach via the DB, or super-user). Stores the reply on the row and
// pushes the athlete so they know the coach responded. Degrades gracefully if
// migration 036 (the coach_reply columns) hasn't been applied yet — returns 501
// with a clear message rather than a 500.
export async function POST(request: Request) {
  try {
    // Staff gate on the VERIFIED session. The actor used to be `actorEmail` from
    // the body, so anyone could post a "coach reply" under a coach's name and
    // push it to the athlete.
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { feedbackId, reply } = await request.json();
    if (!feedbackId || typeof reply !== 'string' || !reply.trim()) {
      return NextResponse.json({ error: 'feedbackId and reply required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Find the feedback row + its athlete (for the push + activity link).
    const { data: fb } = await supabase
      .from('workout_feedback')
      .select('id, athlete_id, garmin_activity_id')
      .eq('id', feedbackId)
      .maybeSingle();
    if (!fb) return NextResponse.json({ error: 'feedback not found' }, { status: 404 });

    const { error } = await supabase
      .from('workout_feedback')
      .update({
        coach_reply: reply.trim().slice(0, 2000),
        coach_reply_at: new Date().toISOString(),
        coach_reply_by: caller.email || null,
      })
      .eq('id', feedbackId);
    if (error) {
      // Column missing → migration 036 not yet applied. Say so clearly.
      if ((error as { code?: string }).code === '42703' || /coach_reply/.test(error.message || '')) {
        return NextResponse.json(
          { error: 'coach-reply columns not migrated yet (run migration 036)' },
          { status: 501 },
        );
      }
      throw error;
    }

    // Notify the athlete their coach replied. Best-effort — never fail the save.
    try {
      const url = fb.garmin_activity_id
        ? `/dashboard/feedback?activity=${fb.garmin_activity_id}`
        : '/dashboard';
      // Personalize with the coach's actual name/id when we can resolve it (there
      // can be more than one coach/admin account) — falls back to the generic
      // "המאמן" title. Best-effort, separate from the auth check above so it
      // never affects who's allowed to reply. Also grab their avatar_url so the
      // push shows the replying coach's actual photo instead of the app icon.
      let coachId = '';
      let coachName = '';
      let coachAvatarUrl = '';
      try {
        const { data: coachRow } = await supabase.from('athletes').select('id, name, avatar_url').eq('email', caller.email).maybeSingle();
        coachId = coachRow?.id || '';
        coachName = coachRow?.name?.trim() || '';
        coachAvatarUrl = coachRow?.avatar_url?.trim() || '';
      } catch { /* best-effort */ }
      await notifyAthlete({
        athleteId: fb.athlete_id,
        kind: 'feedback_reply',
        actorAthleteId: coachId || null,
        title: coachName ? `💬 תשובה מ${coachName}` : '💬 תשובה מהמאמן',
        body: reply.trim().slice(0, 120),
        url,
        tag: `coach-reply-${feedbackId}`,
        category: 'coach',
        ...(coachAvatarUrl ? { icon: coachAvatarUrl } : {}),
      });
    } catch { /* push optional */ }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PATCH /api/workout-feedback/reply { feedbackId, athleteId }
// The athlete marks the coach's reply as seen (clears the "new reply" badge).
// Owner-only: the athleteId must own the feedback row. Idempotent; only stamps
// reply_seen_at once. Degrades gracefully if migration 036 isn't applied.
export async function PATCH(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const { feedbackId, athleteId } = await request.json();
    if (!feedbackId || !athleteId) {
      return NextResponse.json({ error: 'feedbackId and athleteId required' }, { status: 400 });
    }
    // Clearing somebody else's "new reply" badge is harmless but pointless —
    // and it shouldn't be possible.
    if (!mayActFor(caller, athleteId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const supabase = createServerClient();

    // Only stamp when this athlete owns the row and it isn't already seen.
    const { data, error } = await supabase
      .from('workout_feedback')
      .update({ reply_seen_at: new Date().toISOString() })
      .eq('id', feedbackId)
      .eq('athlete_id', athleteId)
      .is('reply_seen_at', null)
      .select('id');
    if (error) {
      if ((error as { code?: string }).code === '42703' || /reply_seen_at/.test(error.message || '')) {
        return NextResponse.json({ ok: true, migrated: false });
      }
      throw error;
    }
    return NextResponse.json({ ok: true, marked: (data || []).length });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
