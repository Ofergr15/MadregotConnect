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
      .select('id, name, garmin_auth');

    if (athleteId) {
      query.eq('id', athleteId);
    } else {
      query.eq('coach_id', COACH_ID).not('garmin_auth', 'is', null);
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
        let activities;
        try {
          activities = await client.getActivities(0, 100);
        } catch (fetchErr: any) {
          results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: `Fetch failed: ${fetchErr.message}` });
          continue;
        }

        if (!activities || activities.length === 0) {
          results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: 'No activities returned from Garmin' });
          continue;
        }

        const runTypes = ['running', 'trail_running', 'treadmill_running', 'track_running', 'street_running', 'indoor_running'];
        const runActivities = activities.filter(a =>
          runTypes.includes(a.activityType) || a.activityType.includes('running')
        );

        if (runActivities.length === 0) {
          results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: `No runs. Types found: ${activities.slice(0, 5).map(a => a.activityType).join(', ')}` });
          continue;
        }

        const { data: existing } = await supabase
          .from('athlete_activities')
          .select('garmin_activity_id')
          .eq('athlete_id', athlete.id);

        const existingIds = new Set((existing || []).map(e => e.garmin_activity_id));
        const newActivities = runActivities.filter(a => !existingIds.has(a.activityId));

        if (newActivities.length > 0) {
          const rows = [];
          for (const a of newActivities) {
            let enriched: any = {};
            try {
              const detail = await client.getActivityFull(a.activityId);
              const summ = detail?.summaryDTO || {};
              // Persist the route polyline so maps load instantly and reliably.
              // [] means "confirmed no GPS" (treadmill/indoor); only fetch when
              // the activity claims a polyline to keep sync fast.
              const gpsPoints = detail.hasPolyline
                ? await client.getActivityGpsPoints(a.activityId)
                : [];
              enriched = {
                start_lat: detail.startLatitude || null,
                start_lng: detail.startLongitude || null,
                end_lat: summ.endLatitude || detail.endLatitude || null,
                end_lng: summ.endLongitude || detail.endLongitude || null,
                avg_cadence: summ.averageRunCadence || null,
                avg_stride_length: summ.strideLength ? Math.round(summ.strideLength * 100) : null,
                vo2max: detail.vO2MaxValue || null,
                lap_count: detail.lapCount || null,
                location_name: detail.locationName || null,
                has_polyline: detail.hasPolyline || false,
                gps_points: gpsPoints,
                moving_duration: summ.movingDuration ? Math.round(summ.movingDuration) : Math.round(a.movingDuration),
              };
            } catch {
              enriched = {
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
                moving_duration: Math.round(a.movingDuration),
              };
            }

            rows.push({
              athlete_id: athlete.id,
              garmin_activity_id: a.activityId,
              activity_name: a.activityName,
              activity_type: a.activityType,
              start_time: a.startTimeLocal,
              distance: Math.round(a.distance),
              duration: Math.round(a.duration),
              average_pace: a.distance > 0 ? Math.round(a.duration / (a.distance / 1000)) : null,
              average_hr: a.averageHR,
              max_hr: a.maxHR,
              calories: a.calories || null,
              elevation_gain: a.elevationGain,
              ...enriched,
            });
          }

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

export async function PATCH(request: Request) {
  try {
    const supabase = createServerClient();

    const { data: activities } = await supabase
      .from('athlete_activities')
      .select('id, garmin_activity_id, athlete_id')
      .is('avg_cadence', null)
      .limit(20);

    if (!activities || activities.length === 0) {
      return NextResponse.json({ enriched: 0, message: 'All activities already enriched' });
    }

    const athleteIds = [...new Set(activities.map(a => a.athlete_id))];
    const { data: athletes } = await supabase
      .from('athletes')
      .select('id, garmin_auth')
      .in('id', athleteIds)
      .not('garmin_auth', 'is', null);

    if (!athletes || athletes.length === 0) {
      return NextResponse.json({ error: 'No athletes with Garmin auth' }, { status: 404 });
    }

    const clientMap = new Map<string, GarminClient>();
    for (const ath of athletes) {
      clientMap.set(ath.id, new GarminClient(ath.garmin_auth as any));
    }

    let enriched = 0;
    const errors: string[] = [];

    for (const act of activities) {
      const client = clientMap.get(act.athlete_id);
      if (!client) continue;

      try {
        const detail = await client.getActivityFull(act.garmin_activity_id);
        const summ = detail?.summaryDTO || {};
        const update: any = {};
        if (detail.startLatitude) update.start_lat = detail.startLatitude;
        if (detail.startLongitude) update.start_lng = detail.startLongitude;
        if (summ.endLatitude || detail.endLatitude) update.end_lat = summ.endLatitude || detail.endLatitude;
        if (summ.endLongitude || detail.endLongitude) update.end_lng = summ.endLongitude || detail.endLongitude;
        if (summ.averageRunCadence) update.avg_cadence = summ.averageRunCadence;
        if (summ.strideLength) update.avg_stride_length = Math.round(summ.strideLength * 100);
        if (detail.vO2MaxValue) update.vo2max = detail.vO2MaxValue;
        if (detail.lapCount) update.lap_count = detail.lapCount;
        if (detail.locationName) update.location_name = detail.locationName;
        if (detail.hasPolyline != null) update.has_polyline = detail.hasPolyline;
        if (summ.movingDuration) update.moving_duration = Math.round(summ.movingDuration);

        if (Object.keys(update).length > 0) {
          await supabase
            .from('athlete_activities')
            .update(update)
            .eq('id', act.id);
          enriched++;
        }
      } catch (e: any) {
        errors.push(`${act.garmin_activity_id}: ${e.message}`);
      }
    }

    return NextResponse.json({ enriched, total: activities.length, errors: errors.length > 0 ? errors : undefined });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createServerClient();
    const { data: athletes } = await supabase
      .from('athletes')
      .select('id, name, garmin_auth')
      .eq('coach_id', COACH_ID)
      .not('garmin_auth', 'is', null)
      .limit(1);

    if (!athletes || athletes.length === 0) {
      return NextResponse.json({ error: 'No athletes' }, { status: 404 });
    }

    const client = new GarminClient(athletes[0].garmin_auth as any);
    const raw = await (client as any).gc.getActivities(0, 2) as any[];
    const sample = raw[0];
    const keys = Object.keys(sample || {});
    const relevant = {
      startLatitude: sample?.startLatitude,
      startLongitude: sample?.startLongitude,
      endLatitude: sample?.endLatitude,
      endLongitude: sample?.endLongitude,
      hasPolyline: sample?.hasPolyline,
      lapCount: sample?.lapCount,
      locationName: sample?.locationName,
      vO2MaxValue: sample?.vO2MaxValue,
      avgStrideLength: sample?.avgStrideLength,
      averageRunningCadenceInStepsPerMinute: sample?.averageRunningCadenceInStepsPerMinute,
      movingDuration: sample?.movingDuration,
      steps: sample?.steps,
    };
    return NextResponse.json({ keys, relevant, raw: sample });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = createServerClient();

    const baseCols = `
        id, athlete_id, garmin_activity_id, activity_name, activity_type,
        start_time, distance, duration, moving_duration, average_pace, average_hr, max_hr,
        calories, elevation_gain, start_lat, start_lng, end_lat, end_lng,
        avg_cadence, avg_stride_length, vo2max, lap_count, location_name,
        has_polyline, splits, created_at,
        athletes (name)`;

    // Prefer selecting gps_points; fall back gracefully if the column hasn't
    // been added yet (migration 018 not yet run) so the feed never 500s.
    let activities: any[] | null = null;
    let error: any = null;
    ({ data: activities, error } = await supabase
      .from('athlete_activities')
      .select(`${baseCols}, gps_points`)
      .order('start_time', { ascending: false })
      .limit(200));

    if (error) {
      ({ data: activities, error } = await supabase
        .from('athlete_activities')
        .select(baseCols)
        .order('start_time', { ascending: false })
        .limit(200));
    }

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
