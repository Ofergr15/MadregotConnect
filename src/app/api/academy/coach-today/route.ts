/**
 * GET /api/academy/coach-today[?scope=coach]
 *
 * The academy coach's Management page: every trainee the caller may coach, with
 * today's planned workout and whether it was done, the last seven days, this week's
 * km, the last feel, and the reasons to look (missed in a row, pain, asked for a
 * reply, off plan) — plus the recent runs and feedback as one list. See
 * lib/academy/coach-today.ts for the rules.
 *
 * Scoped exactly like /api/academy/coach-tools: `visibleTraineeIds` (a coach sees
 * their own trainees; a manager everyone, or their own with `?scope=coach`).
 *
 * Feedback is read directly from `workout_feedback` and is NOT marked read —
 * GET /api/workout-feedback does that, and a dashboard must not clear a coach's
 * unread state just by being opened.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { visibleTraineeIds } from '@/lib/academy/pairing-server';
import { allAcademyTraineeIds } from '@/lib/academy/book-server';
import { computeAcademyWeekAdherence } from '@/lib/academy/report';
import { buildCoachBoard, type FeedbackRow } from '@/lib/academy/coach-today';
import { addDaysToDateStr, israelToday, planWeekStartOf } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FEEDBACK_COLS = 'athlete_id, created_at, feel, difficulty, pain, pain_detail, wants_feedback, comment, coach_reply';

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    const supabase = createServerClient();
    const visible = await visibleTraineeIds(caller, request);
    const ids = visible === null ? await allAcademyTraineeIds(supabase) : [...visible];
    if (!ids.length) return NextResponse.json({ today: israelToday(), trainees: [], events: [] });

    const today = israelToday();
    const thisWeek = planWeekStartOf(today);
    const lastWeek = addDaysToDateStr(thisWeek, -7);
    // On the week's last day "tomorrow" is the next plan week.
    const nextWeek = addDaysToDateStr(today, 1) > addDaysToDateStr(thisWeek, 6) ? addDaysToDateStr(thisWeek, 7) : null;

    const [current, previous, upcoming, feedback, people] = await Promise.all([
      // Execution only where the board prints a score: this week (today's ring).
      computeAcademyWeekAdherence({ weekStart: thisWeek, onlyAthleteIds: ids, withExecution: true }),
      computeAcademyWeekAdherence({ weekStart: lastWeek, onlyAthleteIds: ids }),
      nextWeek ? computeAcademyWeekAdherence({ weekStart: nextWeek, onlyAthleteIds: ids }) : Promise.resolve(null),
      supabase
        .from('workout_feedback')
        .select(FEEDBACK_COLS)
        .in('athlete_id', ids)
        .gte('created_at', `${addDaysToDateStr(today, -7)}T00:00:00Z`)
        .then(({ data, error }) => (error ? [] : (data as FeedbackRow[]))),
      // Photo and phone for the cards (the call / WhatsApp buttons). Staff only, like
      // every contact detail; a pre-061 database without `phone` just loses the buttons.
      supabase
        .from('athletes')
        .select('id, avatar_url, phone')
        .in('id', ids)
        .then(({ data, error }) => (error ? [] : (data as Array<{ id: string; avatar_url: string | null; phone: string | null }>))),
    ]);
    const contact = new Map(people.map((p) => [p.id, p]));

    const board = buildCoachBoard({
      today,
      reports: [current.athletes, previous.athletes, ...(upcoming ? [upcoming.athletes] : [])],
      feedback,
    });
    const trainees = board.trainees.map((t) => ({
      ...t,
      avatarUrl: contact.get(t.athleteId)?.avatar_url ?? null,
      phone: contact.get(t.athleteId)?.phone ?? null,
    }));
    return NextResponse.json({ today, trainees, events: board.events });
  } catch (error) {
    console.error('coach-today error:', error);
    return NextResponse.json({ error: 'Failed to load the board' }, { status: 500 });
  }
}
