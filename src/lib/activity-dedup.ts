import { createServerClient } from '@/lib/supabase/server';

const WINDOW_MS = 15 * 60 * 1000;
const DISTANCE_TOLERANCE = 0.1; // 10%

/**
 * True when this athlete already has a DIFFERENT-source row for what's
 * clearly the same physical run — same start time (within WINDOW_MS) and
 * matching distance (within DISTANCE_TOLERANCE). Needed because Garmin can
 * auto-export a run to Strava, and both garmin/sync-activities and
 * strava/sync-activities import independently, each only deduping within its
 * own id space (garmin_activity_id / strava_activity_id) — neither one alone
 * ever sees the other source's row for the same run. Left unchecked, every
 * such run gets counted twice everywhere athlete_activities rows are summed:
 * cumulative_distance badges, challenges, shoe mileage, and teammate-notify.
 *
 * Callers should only invoke this AFTER their own same-source existence
 * check already ruled out a same-source duplicate — any row this finds is,
 * by construction, from the other source.
 */
export async function hasCrossSourceDuplicate(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  startTimeLocal: string,
  distanceMeters: number,
): Promise<boolean> {
  const start = new Date(startTimeLocal).getTime();
  const { data } = await supabase
    .from('athlete_activities')
    .select('distance')
    .eq('athlete_id', athleteId)
    .gte('start_time', new Date(start - WINDOW_MS).toISOString())
    .lte('start_time', new Date(start + WINDOW_MS).toISOString());

  return (data || []).some((r: { distance: number | null }) => {
    if (!r.distance || distanceMeters <= 0) return false;
    return Math.abs(r.distance - distanceMeters) / distanceMeters <= DISTANCE_TOLERANCE;
  });
}
