import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { formatActivityTime, israelToday } from '@/lib/utils';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { computeAcademyWeekAdherence, sundayOf } from '@/lib/academy/report';
import { buildWorkoutSheet } from '@/lib/academy/workout-sheet';
import { toRoute } from '@/lib/feed/project';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/academy/workout?athleteId=…&date=YYYY-MM-DD
 *
 * One planned workout, planned vs actual — the sheet the trainee opens by tapping
 * a row on their academy home (mockup academy-plan-vs-actual).
 *
 * WHO: the trainee themselves, their own coach, and the manager — `mayCoach`, the
 * academy's 1:1 line, not `mayActFor`'s "any staff". A grade is between a runner
 * and their coach (see /api/plan-execution), and the coach's written feedback rides
 * along. Under the super user's view-as (lib/auth/view-as.ts, which covers
 * /api/academy/*) the caller IS the viewed person, so the same rule decides.
 *
 * WHAT: graded through `computeAcademyWeekAdherence` with `keepDetail` — the same
 * engine, attribution and tolerances as the home's row and the coach's compliance
 * table, so the sheet cannot disagree with the ring that opened it. The laps stay
 * here: `buildWorkoutSheet` reduces them to one point per rep or kilometre.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId') || '';
    const date = searchParams.get('date') || '';
    if (!athleteId || !DATE_RE.test(date)) {
      return NextResponse.json({ error: 'athleteId and date (YYYY-MM-DD) are required' }, { status: 400 });
    }

    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(await mayCoach(caller, athleteId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const report = await computeAcademyWeekAdherence({
      weekStart: sundayOf(date),
      onlyAthleteId: athleteId,
      keepDetail: true,
    });
    const row = report.athletes[0]?.week.workouts.find((w) => w.date === date);
    if (!row) return NextResponse.json({ error: 'no workout planned that day' }, { status: 404 });

    const supabase = createServerClient();
    const [activityRes, feedbackRes] = await Promise.all([
      row.actual
        ? supabase
          .from('athlete_activities')
          .select('id, start_time, location_name, route_preview')
          .eq('id', row.actual.id)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      // The mentor's review of that day, if there is one. A missing table (the
      // hand-applied migration 103) reads as "no feedback yet", never as an error.
      supabase
        .from('academy_workout_feedback')
        .select('note, rendered, author_id')
        .eq('athlete_id', athleteId)
        .eq('workout_date', date)
        .maybeSingle(),
    ]);

    const activity = activityRes.data as {
      start_time: string | null; location_name: string | null; route_preview: unknown;
    } | null;

    let feedback: { text: string; mentorName: string | null } | null = null;
    const fb = feedbackRes.error ? null : feedbackRes.data as { note?: string; rendered?: string; author_id?: string } | null;
    if (fb) {
      // The mentor's own sentence when they wrote one; else the rendered review
      // without its first line, which only repeats the workout's name.
      const text = (fb.note || '').trim()
        || (fb.rendered || '').split('\n').slice(1).join('\n').trim();
      if (text) {
        let mentorName: string | null = null;
        if (fb.author_id) {
          const { data: author } = await supabase.from('athletes').select('name').eq('id', fb.author_id).maybeSingle();
          mentorName = (author as { name?: string } | null)?.name ?? null;
        }
        feedback = { text, mentorName };
      }
    }

    const sheet = buildWorkoutSheet({
      row,
      tolerances: report.tolerances,
      today: israelToday(),
      activity: activity
        ? {
          startClock: activity.start_time ? formatActivityTime(activity.start_time) : null,
          locationName: activity.location_name || null,
          route: toRoute(activity.route_preview),
        }
        : null,
      feedback,
    });
    return NextResponse.json({ sheet });
  } catch (error: unknown) {
    console.error('Academy workout sheet error:', error);
    return NextResponse.json({ error: 'Failed to load the workout' }, { status: 500 });
  }
}
