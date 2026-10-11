import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { activityLocalDateStr, israelToday } from '@/lib/utils';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { buildBodyPayload } from '@/lib/academy/body';
import { loadAthleteFeeds } from '@/lib/academy/data-feed-server';
import { readBodyNights } from '@/lib/academy/body-server';

export const dynamic = 'force-dynamic';

/** Answers read for the feel row: the newest 4 that carry a feel, with room for blanks. */
const FEEDBACK_ROWS = 12;

/**
 * GET /api/academy/body?athleteId=…
 *
 * The trainee's body (mockup trainee-experience-v2, phone 8): this morning's resting HR and
 * last night's sleep against their own normal range, the 30 days behind each, the
 * 3-morning rule, and how their last 4 runs felt. Built by lib/academy/body.ts.
 *
 * Health data, so the academy's 1:1 line and nobody else: the trainee, their coaches and
 * the manager (`mayCoach`, as /api/academy/workout). Read-only. Before migration 123 (or
 * on any read error) the nights are simply none — the screen then shows its learning
 * state, never an error.
 */
export async function GET(request: Request) {
  try {
    const athleteId = new URL(request.url).searchParams.get('athleteId') || '';
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });

    const { denied, caller } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;
    if (!(await mayCoach(caller, athleteId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const supabase = createServerClient();
    const today = israelToday();
    const [nights, feedbackRes, feeds] = await Promise.all([
      // The window the ranges stand on (30 before the newest morning) plus that morning.
      readBodyNights(supabase, athleteId, today),
      supabase
        .from('workout_feedback')
        .select('feel, difficulty, created_at, garmin_activity_id')
        .eq('athlete_id', athleteId)
        .order('created_at', { ascending: false })
        .limit(FEEDBACK_ROWS),
      // Nights come from Garmin only: whether it is connected and still sending.
      loadAthleteFeeds(supabase, athleteId),
    ]);

    const feedback = ((feedbackRes.error ? [] : feedbackRes.data) || []) as any[];
    // Each answer dated by its run (start_time is the watch's wall clock: its UTC date is
    // the run's local day), not by when it was typed.
    const runIds = [...new Set(feedback.map(f => f.garmin_activity_id).filter((v: unknown) => v != null))];
    if (runIds.length) {
      const { data: runs, error: runsErr } = await supabase
        .from('athlete_activities')
        .select('garmin_activity_id, start_time')
        .eq('athlete_id', athleteId)
        .in('garmin_activity_id', runIds);
      if (!runsErr) {
        const dayOf = new Map(((runs || []) as any[]).map(r => [String(r.garmin_activity_id), activityLocalDateStr(String(r.start_time))]));
        for (const f of feedback) f.run_date = dayOf.get(String(f.garmin_activity_id)) ?? null;
      }
    }
    return NextResponse.json({ today, source: feeds.night.kind === 'none' ? 'none' : 'garmin', ...buildBodyPayload({ nights, today, feedback, feed: feeds.night }) });
  } catch (error: unknown) {
    console.error('Academy body error:', error);
    return NextResponse.json({ error: 'Failed to load the body screen' }, { status: 500 });
  }
}
