/**
 * GET /api/staff/attention
 *
 * What is waiting for a coach, as counts: the dot on the "ניהול" tab and the
 * numbers on the Management page's "היום" tiles (Ofer, 2026-10-17: the bar keeps
 * one door for staff, and the door says when something is behind it).
 *
 *  - pain:       feedback reporting pain that no coach has answered yet
 *  - wantsReply: the rest of what is waiting — a request for feedback, a comment
 *  - people:     how many runners those are (one card each on the screen)
 *
 * "Waiting" is lib/feedback/waiting.ts — the same rule as the "מחכים לך" tab (2026-10-19).
 * It used to count every pain of the last 3 days, answered or not, and a request as
 * waiting until `coach_reply` was set — which the thread's messages never set.
 *
 * Scoped by `staffAthleteScope` (club staff: everyone; an academy manager: the
 * academy; an academy coach: their own trainees). Read straight from
 * `workout_feedback` — GET /api/workout-feedback marks threads read, and a badge
 * must never clear the unread state it is counting.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { inScope, staffAthleteScope } from '@/lib/academy/staff-scope';
import { addDaysToDateStr, israelToday } from '@/lib/utils';
import { WAITING_DAYS, isWaiting } from '@/lib/feedback/waiting';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const supabase = createServerClient();
    const today = israelToday();
    const since = `${addDaysToDateStr(today, -WAITING_DAYS)}T00:00:00Z`;
    // The thread messages by date, in the same wave — not `.in(feedback_id, <every id>)`
    // after it: that long list was the slowest read on the staff tab bar (16 s once under
    // load, 2026-10-20). A message is never older than its feedback, so the window holds them all.
    const [scope, { data, error }, { data: msgs }] = await Promise.all([
      staffAthleteScope(supabase, caller),
      supabase
        .from('workout_feedback')
        .select('id, athlete_id, created_at, pain, wants_feedback, comment, coach_reply_at')
        .gte('created_at', since)
        .or('pain.eq.true,wants_feedback.eq.true,comment.not.is.null'),
      supabase.from('workout_feedback_messages').select('feedback_id, sender_athlete_id, created_at').gte('created_at', since),
    ]);
    if (error) return NextResponse.json({ pain: 0, wantsReply: 0, people: 0, total: 0 });
    type Row = { id: string; athlete_id: string; created_at: string; pain: boolean | null; wants_feedback: boolean | null; comment: string | null; coach_reply_at: string | null };
    const rows = inScope(data as Row[], scope, (r) => r.athlete_id);
    const owner = new Map(rows.map((r) => [r.id, r.athlete_id]));
    const thread = new Map<string, Array<{ createdAt: string; fromStaff: boolean }>>();
    for (const m of (msgs || []) as Array<{ feedback_id: string; sender_athlete_id: string; created_at: string }>) {
      if (!owner.has(m.feedback_id)) continue;
      thread.set(m.feedback_id, [...(thread.get(m.feedback_id) || []), { createdAt: m.created_at, fromStaff: m.sender_athlete_id !== owner.get(m.feedback_id) }]);
    }
    const waiting = rows.filter((r) => isWaiting({
      id: r.id, athleteId: r.athlete_id, createdAt: r.created_at, pain: r.pain, wantsFeedback: r.wants_feedback,
      comment: r.comment, coachReplyAt: r.coach_reply_at, messages: thread.get(r.id) || [],
    }));
    const pain = waiting.filter((r) => r.pain).length;
    const wantsReply = waiting.length - pain;
    const people = new Set(waiting.map((r) => r.athlete_id)).size;
    return NextResponse.json(
      { pain, wantsReply, people, total: pain + wantsReply },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (error) {
    console.error('staff attention error:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
