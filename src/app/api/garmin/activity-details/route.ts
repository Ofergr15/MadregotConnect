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
      elevationLoss: number | null;
      cadence: number | null;
      strideLength: number | null;
    }> = [];

    // Get per-KM splits from the details endpoint (has individual km data)
    // The activity.splitSummaries has aggregated totals per type, not individual km splits.
    // Per-km data comes from the details response splitSummaries.
    // First, try from the activity's splitSummaries but only if they look like per-KM
    if (activity?.splitSummaries && Array.isArray(activity.splitSummaries)) {
      // Check if any split has noOfSplits > 1 — that means it's aggregated, not per-km
      const isAggregated = activity.splitSummaries.some((s: any) => s.noOfSplits > 1);

      if (!isAggregated) {
        // Each entry IS an individual split
        for (const split of activity.splitSummaries) {
          if (!split.distance || split.distance < 100) continue;
          splits.push({
            distance: split.distance || 1000,
            duration: split.duration || split.movingDuration || 0,
            averagePace: split.distance > 0 ? Math.round((split.duration || split.movingDuration || 0) / (split.distance / 1000)) : 0,
            averageHR: split.averageHR || null,
            maxHR: split.maxHR || null,
            elevationGain: split.elevationGain || null,
            elevationLoss: split.elevationLoss || null,
            cadence: split.averageRunCadence || null,
            strideLength: split.strideLength || null,
          });
        }
      }
    }

    // If no per-km splits yet, try the splits endpoint which returns individual laps
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
              elevationLoss: lap.elevationLoss || null,
              cadence: lap.averageRunCadence || null,
              strideLength: lap.strideLength || null,
            });
          }
        }
      } catch { /* splits are optional */ }
    }

    // If we still only have aggregated splits (large distances like 15km),
    // generate synthetic per-km splits from the overall activity data
    if (splits.length > 0 && splits.length < 3 && activity?.distance > 3000) {
      const totalKm = Math.floor(activity.distance / 1000);
      if (totalKm > splits.length) {
        // The splits we have are laps not km - keep them but also try details endpoint
        const detailSplits: typeof splits = [];
        try {
          const detailData = await client.getActivityDetails(Number(activityId));
          if (detailData?.splitSummaries && Array.isArray(detailData.splitSummaries)) {
            for (const split of detailData.splitSummaries) {
              if (!split.distance || split.distance < 100) continue;
              detailSplits.push({
                distance: split.distance || 1000,
                duration: split.duration || split.movingDuration || 0,
                averagePace: split.distance > 0 ? Math.round((split.duration || split.movingDuration || 0) / (split.distance / 1000)) : 0,
                averageHR: split.averageHR || null,
                maxHR: split.maxHR || null,
                elevationGain: split.elevationGain || null,
                elevationLoss: split.elevationLoss || null,
                cadence: split.averageRunCadence || null,
                strideLength: split.strideLength || null,
              });
            }
          }
        } catch { /* silent */ }
        if (detailSplits.length > splits.length) {
          splits.length = 0;
          splits.push(...detailSplits);
        }
      }
    }

    // Try to get GPS polyline from the details endpoint
    let gpsPoints: Array<{ lat: number; lng: number }> = [];
    let detailsError: string | null = null;
    try {
      const details = await client.getActivityDetails(Number(activityId));
      // Try geoPolylineDTO first
      if (details?.geoPolylineDTO?.polyline) {
        for (const point of details.geoPolylineDTO.polyline) {
          if (point.lat && point.lon) {
            gpsPoints.push({ lat: point.lat, lng: point.lon });
          }
        }
      }
      // Try metricDescriptors + activityDetailMetrics for lat/lng
      if (gpsPoints.length === 0 && details?.metricDescriptors && details?.activityDetailMetrics) {
        const metrics = details.metricDescriptors as any[];
        const latIdx = metrics.findIndex((m: any) => m.key === 'directLatitude');
        const lngIdx = metrics.findIndex((m: any) => m.key === 'directLongitude');
        if (latIdx >= 0 && lngIdx >= 0 && details.activityDetailMetrics) {
          for (const metric of details.activityDetailMetrics) {
            const vals = metric.metrics;
            if (vals && vals[latIdx] != null && vals[lngIdx] != null && vals[latIdx] !== 0) {
              gpsPoints.push({ lat: vals[latIdx], lng: vals[lngIdx] });
            }
          }
        }
      }
    } catch (e: any) {
      detailsError = e.message;
    }

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

    // Per-step LAPS (separate from the per-km `splits` used by the charts). When a
    // pushed structured workout is run on-watch, Garmin records one lap per step —
    // the basis for per-segment planned-vs-actual verdicts in academy compliance.
    let laps: any[] = [];
    try {
      const lapData = await client.getActivitySplits(Number(activityId));
      if (Array.isArray(lapData) && lapData.length > 1) {
        laps = lapData.map((lap: any) => ({
          distance: lap.distance || 0,
          duration: lap.duration || lap.movingDuration || 0,
          averagePace: lap.distance > 0 ? Math.round((lap.duration || lap.movingDuration || 0) / (lap.distance / 1000)) : null,
          averageHR: lap.averageHR ?? null,
          maxHR: lap.maxHR ?? null,
        }));
      }
    } catch { /* laps are optional */ }

    // Cache splits, laps, and enrichment data to DB
    const updatePayload: any = { ...enrichData };
    if (splits.length > 0) updatePayload.splits = splits;
    if (laps.length > 0) updatePayload.laps = laps;

    if (Object.keys(updatePayload).length > 0) {
      const { error: updErr } = await supabase
        .from('athlete_activities')
        .update(updatePayload)
        .eq('athlete_id', athleteId)
        .eq('garmin_activity_id', Number(activityId));
      // The `laps` column may not be migrated yet → retry without it rather than
      // losing the splits/enrichment cache.
      if (updErr && 'laps' in updatePayload) {
        delete updatePayload.laps;
        await supabase
          .from('athlete_activities')
          .update(updatePayload)
          .eq('athlete_id', athleteId)
          .eq('garmin_activity_id', Number(activityId));
      }
    }

    return NextResponse.json({
      gpsPoints,
      splits,
      detailsError,
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
