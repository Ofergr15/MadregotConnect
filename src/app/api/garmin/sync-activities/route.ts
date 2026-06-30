import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { GarminClient } from '@/lib/garmin/client';
import { COACH_ID } from '@/lib/constants';

export async function POST(request: Request) {
  try {
    const { athleteId } = await request.json();
    const supabase = createServerClient();

    const query = supabase
      .from('athletes')
      .select('id, name, garmin_auth')
      .eq('coach_id', COACH_ID);

    if (athleteId) {
      query.eq('id', athleteId);
    } else {
      query.not('garmin_auth', 'is', null);
    }

    const { data: athletes, error: athError } = await query;
    if (athError) throw athError;
    if (!athletes || athletes.length === 0) {
      return NextResponse.json({ synced: 0, message: 'No athletes with Garmin auth found' });
    }

    let totalSynced = 0;
    const results: Array<{ athleteId: string; name: string; synced: number; error?: string }> = [];

    for (const athlete of athletes) {
      if (!athlete.garmin_auth) continue;

      try {
        const client = new GarminClient(athlete.garmin_auth as any);
        const activities = await client.getActivities(0, 30);

        const runActivities = activities.filter(a =>
          ['running', 'trail_running', 'treadmill_running', 'track_running'].includes(a.activityType)
        );

        if (runActivities.length === 0) {
          results.push({ athleteId: athlete.id, name: athlete.name, synced: 0 });
          continue;
        }

        const { data: existing } = await supabase
          .from('athlete_activities')
          .select('garmin_activity_id')
          .eq('athlete_id', athlete.id);

        const existingIds = new Set((existing || []).map(e => e.garmin_activity_id));
        const newActivities = runActivities.filter(a => !existingIds.has(a.activityId));

        if (newActivities.length > 0) {
          const rows = newActivities.map(a => ({
            athlete_id: athlete.id,
            garmin_activity_id: a.activityId,
            activity_name: a.activityName,
            activity_type: a.activityType,
            start_time: a.startTimeLocal,
            distance: Math.round(a.distance),
            duration: Math.round(a.duration),
            moving_duration: Math.round(a.movingDuration),
            average_pace: a.distance > 0 ? Math.round(a.duration / (a.distance / 1000)) : null,
            average_hr: a.averageHR,
            max_hr: a.maxHR,
            calories: a.calories || null,
            elevation_gain: a.elevationGain,
            start_lat: a.startLatitude,
            start_lng: a.startLongitude,
            end_lat: a.endLatitude,
            end_lng: a.endLongitude,
            avg_cadence: a.averageRunningCadence,
            avg_stride_length: a.avgStrideLength,
            vo2max: a.vO2MaxValue,
            lap_count: a.lapCount,
            location_name: a.locationName,
            has_polyline: a.hasPolyline,
          }));

          const { error: insertError } = await supabase
            .from('athlete_activities')
            .insert(rows);

          if (insertError) throw insertError;
          totalSynced += newActivities.length;
        }

        results.push({ athleteId: athlete.id, name: athlete.name, synced: newActivities.length });
      } catch (e: any) {
        results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: e.message });
      }
    }

    return NextResponse.json({ synced: totalSynced, results });
  } catch (error: any) {
    console.error('Activity sync error:', error);
    return NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = createServerClient();

    const { data: activities, error } = await supabase
      .from('athlete_activities')
      .select(`
        id, athlete_id, garmin_activity_id, activity_name, activity_type,
        start_time, distance, duration, moving_duration, average_pace, average_hr, max_hr,
        calories, elevation_gain, start_lat, start_lng, end_lat, end_lng,
        avg_cadence, avg_stride_length, vo2max, lap_count, location_name,
        has_polyline, splits, created_at,
        athletes (name)
      `)
      .order('start_time', { ascending: false })
      .limit(50);

    if (error) throw error;

    const enriched = (activities || []).map((a: any) => ({
      ...a,
      athlete_name: a.athletes?.name || 'Unknown',
      athletes: undefined,
    }));

    return NextResponse.json({ activities: enriched });
  } catch (error: any) {
    console.error('Fetch activities error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch' }, { status: 500 });
  }
}
