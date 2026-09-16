import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import {
  NOTE_MAX,
  LAP_COMMENT_MAX,
  isMissingFeedbackTable,
  renderFeedbackHebrew,
  validateFeedback,
  type ActionTag,
  type EffortTag,
  type ExecutionTag,
  type LapComment,
  type WorkoutFeedback,
} from '@/lib/academy/feedback';
import { ACTION_LABELS, EFFORT_LABELS, EXECUTION_LABELS } from '@/lib/academy/feedback';

export const dynamic = 'force-dynamic';

/**
 * The mentor's weekly feedback on one workout.
 *
 * GET  ?athleteId=&date=            → the feedback already written for that day (or null)
 * GET  ?athleteId=&from=&to=        → the range, for the queue and the trainee's history
 * POST { athleteId, date, ... }     → write it (upsert — a mentor may revise a draft)
 *
 * Reading is self-or-staff: feedback is written ABOUT a trainee and addressed TO
 * them, so they see their own and staff see everyone's. Writing is staff only — the
 * whole value of a uniform form is that the feedback came from a mentor.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });

    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!mayActFor(caller, athleteId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const date = searchParams.get('date');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const supabase = createServerClient();
    let q = supabase
      .from('academy_workout_feedback')
      .select('*')
      .eq('athlete_id', athleteId)
      .order('workout_date', { ascending: false });
    if (date) q = q.eq('workout_date', date);
    if (from) q = q.gte('workout_date', from);
    if (to) q = q.lte('workout_date', to);

    const { data, error } = await q;
    if (error) {
      // The table is a hand-applied migration (103). Until it is pasted, the screen
      // should render the workout with an empty form rather than an error banner —
      // reviewing is still possible, saving is what isn't.
      if (isMissingFeedbackTable(error)) return NextResponse.json({ feedback: date ? null : [], unmigrated: true });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []).map(toApi);
    return NextResponse.json(date ? { feedback: rows[0] ?? null } : { feedback: rows });
  } catch (error: any) {
    console.error('Academy feedback GET error:', error);
    return NextResponse.json({ error: error.message || 'Failed to read feedback' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);
    // Staff only, and deliberately not self: a trainee writing their own uniform
    // feedback would make the mentor-minutes metric meaningless and the history a
    // mix of two different things.
    if (!auth.user.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const body = await request.json();
    const athleteId = String(body.athleteId || '');
    const date = String(body.date || '');
    if (!athleteId || !date) {
      return NextResponse.json({ error: 'athleteId and date are required' }, { status: 400 });
    }

    const feedback: WorkoutFeedback = {
      execution: sanitizeTags(body.execution, EXECUTION_LABELS) as ExecutionTag[],
      effort: (sanitizeTags(body.effort ? [body.effort] : [], EFFORT_LABELS)[0] ?? null) as EffortTag | null,
      action: (sanitizeTags(body.action ? [body.action] : [], ACTION_LABELS)[0] ?? null) as ActionTag | null,
      lapComments: sanitizeLapComments(body.lapComments),
      note: String(body.note ?? '').slice(0, NOTE_MAX),
    };

    const problems = validateFeedback(feedback);
    if (problems.length) {
      return NextResponse.json({ error: problems[0].message, problems }, { status: 422 });
    }

    // Rendered HERE, not on the client: the point of the uniform form is that one
    // place decides how feedback reads, and a client-supplied string would let a
    // patched or older client write whatever it liked into the trainee's message.
    const rendered = renderFeedbackHebrew(feedback, {
      workoutName: String(body.workoutName || '').slice(0, 200),
      mentorName: body.mentorName ? String(body.mentorName).slice(0, 60) : undefined,
      segments: Array.isArray(body.segments) ? body.segments : undefined,
    });

    const supabase = createServerClient();
    const row = {
      athlete_id: athleteId,
      workout_date: date,
      activity_id: body.activityId ? String(body.activityId) : null,
      author_id: auth.user.athleteId ?? null,
      execution: feedback.execution,
      effort: feedback.effort,
      action: feedback.action,
      lap_comments: feedback.lapComments,
      note: feedback.note,
      rendered,
      metric: body.metric === 'pace' || body.metric === 'hr' || body.metric === 'mixed' ? body.metric : null,
      // A save IS the send. There is no separate "publish" step because a mentor who
      // has filled the form has finished the review, and a draft the trainee never
      // receives is the WhatsApp silence this replaces.
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('academy_workout_feedback')
      .upsert(row, { onConflict: 'athlete_id,workout_date,activity_id' })
      .select('*')
      .maybeSingle();

    if (error) {
      if (isMissingFeedbackTable(error)) {
        return NextResponse.json(
          { error: 'טבלת הפידבק עוד לא הוקמה במסד — הרץ את מיגרציה 103.', code: 'unmigrated' },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ feedback: data ? toApi(data) : null, rendered });
  } catch (error: any) {
    console.error('Academy feedback POST error:', error);
    return NextResponse.json({ error: error.message || 'Failed to save feedback' }, { status: 500 });
  }
}

/** Postgres 42P01 = undefined_table; PostgREST also reports it in the message. */
/** Only values the closed vocabulary defines — an unknown tag would render blank. */
function sanitizeTags(raw: unknown, labels: Record<string, string>): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter(t => t in labels);
}

function sanitizeLapComments(raw: unknown): LapComment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c: any) => ({ index: Number(c?.index), text: String(c?.text ?? '').slice(0, LAP_COMMENT_MAX) }))
    .filter(c => Number.isInteger(c.index) && c.index >= 0 && c.text.trim().length > 0);
}

function toApi(row: any) {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    date: row.workout_date,
    activityId: row.activity_id,
    authorId: row.author_id,
    execution: row.execution ?? [],
    effort: row.effort ?? null,
    action: row.action ?? null,
    lapComments: row.lap_comments ?? [],
    note: row.note ?? '',
    rendered: row.rendered ?? '',
    metric: row.metric ?? null,
    sentAt: row.sent_at ?? null,
  };
}
