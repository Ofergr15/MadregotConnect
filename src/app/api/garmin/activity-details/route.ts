import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { GarminClient } from '@/lib/garmin/client';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const activityId = searchParams.get('activityId');
    const athleteId = searchParams.get('athleteId');

    if (!activityId || !athleteId) {
      return NextResponse.json({ error: 'activityId and athleteId required' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: athlete, error } = await supabase
      .from('athletes')
      .select('garmin_auth')
      .eq('id', athleteId)
      .single();

    if (error || !athlete?.garmin_auth) {
      return NextResponse.json({ error: 'Athlete not found or no Garmin auth' }, { status: 404 });
    }

    const client = new GarminClient(athlete.garmin_auth as any);

    // Get full activity data using the library's built-in method
    const activity = await client.getActivityFull(Number(activityId));

    // Extract splits from the activity's splitSummaries
    const splits: Array<{
      distance: number;
      duration: number;
      averagePace: number;
      averageHR: number | null;
      maxHR: number | null;
      elevationGain: number | null;
      cadence: number | null;
      strideLength: number | null;
    }> = [];

    if (activity?.splitSummaries && Array.isArray(activity.splitSummaries)) {
      const kmSplits = activity.splitSummaries.filter(
        (s: any) => s.splitType === 'KM_SPLIT' || s.splitType === 'KILOMETER' || s.splitType === 'RUN_KM_SPLIT'
      );

      const splitsToUse = kmSplits.length > 0 ? kmSplits : activity.splitSummaries;

      for (const split of splitsToUse) {
        if (!split.distance || split.distance < 100) continue;
        splits.push({
          distance: split.distance || 1000,
          duration: split.duration || split.movingDuration || 0,
          averagePace: split.distance > 0 ? Math.round((split.duration || split.movingDuration || 0) / (split.distance / 1000)) : 0,
          averageHR: split.averageHR || null,
          maxHR: split.maxHR || null,
          elevationGain: split.elevationGain || null,
          cadence: split.averageRunCadence || null,
          strideLength: split.strideLength || null,
        });
      }
    }

    // If no splits from activity, try the splits endpoint
    if (splits.length === 0) {
      try {
        const lapData = await client.getActivitySplits(Number(activityId));
        if (lapData && Array.isArray(lapData)) {
          for (const lap of lapData) {
            if (!lap.distance || lap.distance < 100) continue;
            splits.push({
              distance: lap.distance || 0,
              duration: lap.duration || lap.movingDuration || 0,
              averagePace: lap.distance > 0 ? Math.round((lap.duration || 0) / (lap.distance / 1000)) : 0,
              averageHR: lap.averageHR || null,
              maxHR: lap.maxHR || null,
              elevationGain: lap.elevationGain || null,
              cadence: lap.averageRunCadence || null,
              strideLength: lap.strideLength || null,
            });
          }
        }
      } catch { /* splits are optional */ }
    }

    // Try to get GPS polyline from the details endpoint
    let gpsPoints: Array<{ lat: number; lng: number }> = [];
    try {
      const details = await client.getActivityDetails(Number(activityId));
      if (details?.geoPolylineDTO?.polyline) {
        for (const point of details.geoPolylineDTO.polyline) {
          if (point.lat && point.lon) {
            gpsPoints.push({ lat: point.lat, lng: point.lon });
          }
        }
      }
    } catch { /* GPS is optional */ }

    // If no GPS from details, use start/end points from the activity
    if (gpsPoints.length === 0 && activity?.startLatitude && activity?.startLongitude) {
      gpsPoints.push({ lat: activity.startLatitude, lng: activity.startLongitude });
      if (activity.endLatitude && activity.endLongitude) {
        gpsPoints.push({ lat: activity.endLatitude, lng: activity.endLongitude });
      }
    }

    // Extract summary stats
    const summary = activity?.summaryDTO || activity?.summary || null;

    // Extract enrichment data to update the DB record
    const enrichData: any = {};
    if (activity?.startLatitude) enrichData.start_lat = activity.startLatitude;
    if (activity?.startLongitude) enrichData.start_lng = activity.startLongitude;
    if (activity?.endLatitude) enrichData.end_lat = activity.endLatitude;
    if (activity?.endLongitude) enrichData.end_lng = activity.endLongitude;
    if (activity?.locationName) enrichData.location_name = activity.locationName;
    if (activity?.hasPolyline != null) enrichData.has_polyline = activity.hasPolyline;

    const summ = activity?.summaryDTO || {};
    if (summ.averageRunCadence) enrichData.avg_cadence = summ.averageRunCadence;
    if (summ.strideLength) enrichData.avg_stride_length = Math.round(summ.strideLength * 100);
    if (activity?.vO2MaxValue) enrichData.vo2max = activity.vO2MaxValue;
    if (activity?.lapCount) enrichData.lap_count = activity.lapCount;
    if (summ.movingDuration) enrichData.moving_duration = Math.round(summ.movingDuration);

    // Cache splits and enrichment data to DB
    const updatePayload: any = { ...enrichData };
    if (splits.length > 0) updatePayload.splits = splits;

    if (Object.keys(updatePayload).length > 0) {
      await supabase
        .from('athlete_activities')
        .update(updatePayload)
        .eq('athlete_id', athleteId)
        .eq('garmin_activity_id', Number(activityId));
    }

    return NextResponse.json({
      gpsPoints,
      splits,
      summary: {
        startLatitude: activity?.startLatitude,
        startLongitude: activity?.startLongitude,
        endLatitude: activity?.endLatitude,
        endLongitude: activity?.endLongitude,
        locationName: activity?.locationName,
        movingDuration: summ.movingDuration || activity?.movingDuration,
        calories: summ.calories || activity?.calories,
        averageHR: summ.averageHR || activity?.averageHR,
        maxHR: summ.maxHR || activity?.maxHR,
        averageRunCadence: summ.averageRunCadence,
        maxRunCadence: summ.maxRunCadence,
        strideLength: summ.strideLength,
        elevationGain: summ.elevationGain || activity?.elevationGain,
        elevationLoss: summ.elevationLoss || activity?.elevationLoss,
        vO2MaxValue: activity?.vO2MaxValue,
        trainingEffect: summ.trainingEffect,
        anaerobicTrainingEffect: summ.anaerobicTrainingEffect,
      },
    });
  } catch (error: any) {
    console.error('Activity details error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch details' }, { status: 500 });
  }
}
