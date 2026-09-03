/**
 * GET /api/run-chat/laps?activityId=…
 *
 * Laps for one activity, for the interactive laps table on the run card.
 * Kept out of the Stream attachment so messages stay small and old cards
 * pick up laps that were enriched later.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSession, authError } from '@/lib/auth-session';
import { createServerClient } from '@/lib/supabase/server';
import { canAccessChat } from '@/lib/run-chat/access';
import type { StravaLap } from '@/lib/strava/client';
import { enrichActivityRowFromStrava } from '@/lib/strava/enrich';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);

  const activityId = request.nextUrl.searchParams.get('activityId');
  if (!activityId) return NextResponse.json({ error: 'activityId required' }, { status: 400 });

  try {
    const supabase = createServerClient();
    const select = 'id, athlete_id, laps, strava_activity_id, activity_name, start_time';
    const [{ data: initial }, { data: chat }] = await Promise.all([
      supabase.from('athlete_activities').select(select).eq('id', activityId).maybeSingle(),
      supabase
        .from('run_chats')
        .select('athlete_id, coach_id')
        .eq('activity_id', activityId)
        .maybeSingle(),
    ]);
    let activity = initial;
    if (!activity) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canAccessChat(auth.user, chat || { athlete_id: activity.athlete_id, coach_id: null })) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // `laps === null` means the sync never enriched this run (it only reaches
    // the newest ones). Enrich now so historical cards get the same table;
    // enrichment stores `[]` when Strava has nothing, so this runs once.
    if (activity.laps == null && activity.strava_activity_id) {
      try {
        const enriched = await enrichActivityRowFromStrava(supabase, activity);
        if (enriched) {
          const { data: fresh } = await supabase
            .from('athlete_activities')
            .select(select)
            .eq('id', activityId)
            .maybeSingle();
          activity = fresh ?? activity;
        }
      } catch (error) {
        console.warn('GET /api/run-chat/laps: on-demand enrichment failed', activityId, error);
      }
    }

    const laps = (Array.isArray(activity.laps) ? activity.laps : []) as StravaLap[];
    return NextResponse.json({
      laps: laps.map((lap, index) => ({
        lap_index: lap.lap_index ?? index + 1,
        name: lap.name,
        distance: lap.distance,
        moving_time: lap.moving_time,
        elapsed_time: lap.elapsed_time,
        average_speed: lap.average_speed,
        ...(lap.average_heartrate ? { average_heartrate: lap.average_heartrate } : {}),
      })),
    });
  } catch (error: unknown) {
    console.error('GET /api/run-chat/laps error:', error);
    return NextResponse.json({ error: 'Could not load laps' }, { status: 500 });
  }
}
