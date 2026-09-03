import type { StravaLap } from '@/lib/strava/client';

export type RunActivity = {
  id: string;
  activity_name: string | null;
  start_time: string;
  distance: number;
  duration: number;
  moving_duration?: number | null;
  average_pace?: number | null;
  average_hr?: number | null;
  max_hr?: number | null;
  elevation_gain?: number | null;
  avg_cadence?: number | null;
  perceived_rpe?: number | null;
  perceived_feel?: number | null;
  strava_activity_id?: number | null;
  laps?: StravaLap[] | null;
};

export function paceSeconds(distanceM: number, durationS: number): number | null {
  if (!distanceM || !durationS) return null;
  return durationS / (distanceM / 1000);
}

export function formatPace(secondsPerKm: number | null | undefined): string | null {
  if (!secondsPerKm || !Number.isFinite(secondsPerKm)) return null;
  const rounded = Math.round(secondsPerKm);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}/km`;
}

export function normalizedLaps(laps: StravaLap[] | null | undefined) {
  return (laps || []).map((lap, index) => {
    const duration = lap.moving_time || lap.elapsed_time || 0;
    const pace = paceSeconds(lap.distance, duration);
    return {
      lap: lap.lap_index || lap.index || index + 1,
      name: lap.name || `Lap ${index + 1}`,
      distance_m: Math.round(lap.distance),
      time_s: Math.round(duration),
      pace_s_per_km: pace ? Math.round(pace) : null,
      pace: formatPace(pace),
      average_hr: lap.average_heartrate ? Math.round(lap.average_heartrate) : null,
      max_hr: lap.max_heartrate ? Math.round(lap.max_heartrate) : null,
      average_cadence:
        'average_cadence' in lap && typeof lap.average_cadence === 'number'
          ? Math.round(lap.average_cadence * 2)
          : null,
      elevation_gain_m:
        'total_elevation_gain' in lap && typeof lap.total_elevation_gain === 'number'
          ? Math.round(lap.total_elevation_gain * 10) / 10
          : null,
    };
  });
}

export function activitySummary(activity: RunActivity) {
  const duration = activity.moving_duration || activity.duration;
  const pace = activity.average_pace || paceSeconds(activity.distance, duration);
  return {
    id: activity.id,
    strava_activity_id: activity.strava_activity_id || null,
    name: activity.activity_name,
    date: activity.start_time,
    distance_m: Math.round(activity.distance),
    distance_km: Math.round((activity.distance / 1000) * 100) / 100,
    duration_s: Math.round(duration),
    pace_s_per_km: pace ? Math.round(pace) : null,
    pace: formatPace(pace),
    average_hr: activity.average_hr ? Math.round(activity.average_hr) : null,
    max_hr: activity.max_hr ? Math.round(activity.max_hr) : null,
    elevation_gain_m: activity.elevation_gain ? Math.round(activity.elevation_gain) : null,
    average_cadence: activity.avg_cadence ? Math.round(activity.avg_cadence) : null,
    perceived_rpe: activity.perceived_rpe ?? null,
    perceived_feel: activity.perceived_feel ?? null,
    lap_count: activity.laps?.length || 0,
  };
}

export function lapAnalysis(activity: RunActivity) {
  const laps = normalizedLaps(activity.laps);
  const paced = laps.filter((lap) => lap.pace_s_per_km != null);
  const fastest = paced.reduce<(typeof laps)[number] | null>(
    (best, lap) =>
      !best || (lap.pace_s_per_km || Infinity) < (best.pace_s_per_km || Infinity) ? lap : best,
    null,
  );
  const slowest = paced.reduce<(typeof laps)[number] | null>(
    (worst, lap) =>
      !worst || (lap.pace_s_per_km || 0) > (worst.pace_s_per_km || 0) ? lap : worst,
    null,
  );
  const firstHalf = laps.slice(0, Math.max(1, Math.floor(laps.length / 2)));
  const secondHalf = laps.slice(Math.floor(laps.length / 2));
  const avgHr = (items: typeof laps) => {
    const hrs = items.map((lap) => lap.average_hr).filter((hr): hr is number => hr != null);
    return hrs.length ? Math.round(hrs.reduce((sum, hr) => sum + hr, 0) / hrs.length) : null;
  };
  const firstHalfHr = avgHr(firstHalf);
  const secondHalfHr = avgHr(secondHalf);

  return {
    activity: activitySummary(activity),
    laps,
    analysis: {
      fastest_lap: fastest,
      slowest_lap: slowest,
      pace_spread_s_per_km:
        fastest?.pace_s_per_km && slowest?.pace_s_per_km
          ? slowest.pace_s_per_km - fastest.pace_s_per_km
          : null,
      first_half_average_hr: firstHalfHr,
      second_half_average_hr: secondHalfHr,
      heart_rate_drift_bpm:
        firstHalfHr != null && secondHalfHr != null ? secondHalfHr - firstHalfHr : null,
    },
  };
}

export function compareRuns(current: RunActivity, comparison: RunActivity) {
  const a = activitySummary(current);
  const b = activitySummary(comparison);
  return {
    current: a,
    comparison: b,
    delta_current_minus_comparison: {
      distance_m: a.distance_m - b.distance_m,
      duration_s: a.duration_s - b.duration_s,
      pace_s_per_km:
        a.pace_s_per_km != null && b.pace_s_per_km != null
          ? a.pace_s_per_km - b.pace_s_per_km
          : null,
      average_hr:
        a.average_hr != null && b.average_hr != null ? a.average_hr - b.average_hr : null,
      elevation_gain_m:
        a.elevation_gain_m != null && b.elevation_gain_m != null
          ? a.elevation_gain_m - b.elevation_gain_m
          : null,
    },
  };
}

/** Pace gap (sec/km) at which two runs are considered completely different. */
const PACE_GAP_FULL = 90;

/**
 * 0–100 similarity. Distance and pace always count; lap structure only when
 * both runs have laps. Most stored runs are not lap-enriched, so scoring lap
 * data as "0 when missing" used to rank any enriched run above every
 * unenriched one regardless of distance.
 */
export function similarRunScore(current: RunActivity, candidate: RunActivity) {
  const maxDistance = Math.max(current.distance, candidate.distance, 1);
  const distanceScore = 1 - Math.min(1, Math.abs(current.distance - candidate.distance) / maxDistance);

  const currentPace =
    current.average_pace || paceSeconds(current.distance, current.moving_duration || current.duration);
  const candidatePace =
    candidate.average_pace ||
    paceSeconds(candidate.distance, candidate.moving_duration || candidate.duration);
  const paceScore =
    currentPace && candidatePace
      ? 1 - Math.min(1, Math.abs(currentPace - candidatePace) / PACE_GAP_FULL)
      : distanceScore;

  const currentLaps = current.laps?.length || 0;
  const candidateLaps = candidate.laps?.length || 0;
  if (currentLaps && candidateLaps) {
    const lapScore =
      1 - Math.abs(currentLaps - candidateLaps) / Math.max(currentLaps, candidateLaps);
    return Math.round((distanceScore * 0.45 + paceScore * 0.35 + lapScore * 0.2) * 100);
  }
  return Math.round((distanceScore * 0.55 + paceScore * 0.45) * 100);
}
