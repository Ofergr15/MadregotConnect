/**
 * GET /api/staff/attention
 *
 * What is waiting for a coach, as counts: the dot on the "ניהול" tab and the
 * numbers on the Management page's "היום" tiles (Ofer, 2026-10-17: the bar keeps
 * one door for staff, and the door says when something is behind it).
 *
 *  - pain:      feedback reporting pain in the last 3 days
 *  - wantsReply: feedback that asked for the coach's answer and has none yet
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

export const dynamic = 'force-dynamic';

const PAIN_DAYS = 3;
const REPLY_DAYS = 7;

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const supabase = createServerClient();
    const today = israelToday();
    const [scope, { data, error }] = await Promise.all([
      staffAthleteScope(supabase, caller),
      supabase
        .from('workout_feedback')
        .select('athlete_id, created_at, pain, wants_feedback, coach_reply')
        .gte('created_at', `${addDaysToDateStr(today, -REPLY_DAYS)}T00:00:00Z`)
        .or('pain.eq.true,wants_feedback.eq.true'),
    ]);
    if (error) return NextResponse.json({ pain: 0, wantsReply: 0, total: 0 });
    const rows = inScope(data as Array<{ athlete_id: string; created_at: string; pain: boolean | null; wants_feedback: boolean | null; coach_reply: string | null }>, scope, (r) => r.athlete_id);
    const painFrom = addDaysToDateStr(today, -PAIN_DAYS);
    const pain = rows.filter((r) => r.pain && r.created_at.slice(0, 10) >= painFrom).length;
    const wantsReply = rows.filter((r) => r.wants_feedback && !r.coach_reply).length;
    return NextResponse.json(
      { pain, wantsReply, total: pain + wantsReply },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (error) {
    console.error('staff attention error:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
