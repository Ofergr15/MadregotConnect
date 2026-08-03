import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sendPushToSubscriptions } from '@/lib/push';
import { APPROVER_EMAILS } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// GET /api/workout-feedback?athleteId=…&activityId=…
// Returns the watch Self-Evaluation for the activity (to pre-fill / adapt the
// form) plus any feedback already submitted.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    const activityId = searchParams.get('activityId');
    if (!athleteId || !activityId) {
      return NextResponse.json({ error: 'athleteId and activityId required' }, { status: 400 });
    }
    const supabase = createServerClient();

    const { data: activity } = await supabase
      .from('athlete_activities')
      .select('activity_name, activity_type, distance, start_time, perceived_rpe, perceived_feel')
      .eq('athlete_id', athleteId)
      .eq('garmin_activity_id', Number(activityId))
      .maybeSingle();

    const { data: existing } = await supabase
      .from('workout_feedback')
      .select('difficulty, feel, pain, pain_detail, wants_feedback')
      .eq('athlete_id', athleteId)
      .eq('garmin_activity_id', Number(activityId))
      .maybeSingle();

    return NextResponse.json({
      activity: activity || null,
      // Watch Self-Evaluation → seed the form; adapt follow-ups off these.
      watchRpe: activity?.perceived_rpe ?? null,
      watchFeel: activity?.perceived_feel ?? null,
      existing: existing || null,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/workout-feedback  { athleteId, activityId, difficulty, feel, pain, painDetail, wantsFeedback }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { athleteId, activityId, difficulty, feel, pain, painDetail, wantsFeedback } = body;
    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    }
    const supabase = createServerClient();

    const { error } = await supabase
      .from('workout_feedback')
      .upsert(
        {
          athlete_id: athleteId,
          garmin_activity_id: activityId ? Number(activityId) : null,
          difficulty: difficulty ?? null,
          feel: feel ?? null,
          pain: pain ?? null,
          pain_detail: painDetail || null,
          wants_feedback: wantsFeedback ?? null,
        },
        { onConflict: 'athlete_id,garmin_activity_id' },
      );
    if (error) throw error;

    // Team alert (PRD §1): high difficulty (>=9), reported pain, or an explicit
    // request for feedback → push the coaches so they can reach out.
    const flag = (difficulty != null && difficulty >= 9) || pain === true || wantsFeedback === true;
    if (flag) {
      try {
        const { data: athlete } = await supabase
          .from('athletes')
          .select('name')
          .eq('id', athleteId)
          .maybeSingle();
        const name = athlete?.name || 'רץ/ה';
        const reason = pain ? 'דיווח/ה על כאב' : (difficulty >= 9 ? 'קושי גבוה מאוד' : 'ביקש/ה משוב');
        // Coaches are the athletes whose email is on the approver allowlist.
        const { data: coaches } = await supabase
          .from('athletes')
          .select('id')
          .in('email', APPROVER_EMAILS);
        const coachIds = (coaches || []).map((c: { id: string }) => c.id);
        if (coachIds.length > 0) {
          const { data: subs } = await supabase
            .from('push_subscriptions')
            .select('id, endpoint, p256dh, auth, athlete_id')
            .in('athlete_id', coachIds);
          if (subs && subs.length > 0) {
            await sendPushToSubscriptions(subs as any, {
              title: '⚠️ משוב אימון',
              body: `${name}: ${reason}`,
              url: '/dashboard/review',
              tag: `feedback-alert-${athleteId}`,
              badge: 1,
            });
          }
        }
      } catch { /* never let the alert fail the submit */ }
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
