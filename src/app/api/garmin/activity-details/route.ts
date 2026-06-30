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
    const details = await client.getActivityDetails(Number(activityId));

    // Extract GPS polyline from metrics
    const gpsPoints: Array<{ lat: number; lng: number }> = [];
    if (details?.geoPolylineDTO?.polyline) {
      for (const point of details.geoPolylineDTO.polyline) {
        if (point.lat && point.lon) {
          gpsPoints.push({ lat: point.lat, lng: point.lon });
        }
      }
    }

    // Extract splits/laps
    const splits: Array<{
      distance: number;
      duration: number;
      averagePace: number;
      averageHR: number | null;
      elevationGain: number | null;
    }> = [];

    if (details?.splitSummaries) {
      const kmSplits = details.splitSummaries.filter(
        (s: any) => s.splitType === 'KM_SPLIT' || s.splitType === 'KILOMETER'
      );
      if (kmSplits.length > 0) {
        for (const split of kmSplits) {
          splits.push({
            distance: split.distance || 1000,
            duration: split.duration || 0,
            averagePace: split.distance > 0 ? Math.round(split.duration / (split.distance / 1000)) : 0,
            averageHR: split.averageHR || null,
            elevationGain: split.elevationGain || null,
          });
        }
      }
    }

    // Also try fetching laps separately if no splits
    if (splits.length === 0) {
      try {
        const lapData = await client.getActivitySplits(Number(activityId));
        for (const lap of lapData) {
          splits.push({
            distance: lap.distance || 0,
            duration: lap.duration || 0,
            averagePace: lap.distance > 0 ? Math.round(lap.duration / (lap.distance / 1000)) : 0,
            averageHR: lap.averageHR || null,
            elevationGain: lap.elevationGain || null,
          });
        }
      } catch {
        // silent — splits are optional
      }
    }

    // Store splits in DB for caching
    if (splits.length > 0) {
      await supabase
        .from('athlete_activities')
        .update({ splits })
        .eq('athlete_id', athleteId)
        .eq('garmin_activity_id', Number(activityId));
    }

    return NextResponse.json({
      gpsPoints,
      splits,
      summary: details?.summaryDTO || null,
    });
  } catch (error: any) {
    console.error('Activity details error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch details' }, { status: 500 });
  }
}
