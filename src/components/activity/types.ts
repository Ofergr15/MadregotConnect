/**
 * The shapes the activity detail UI works in. Extracted from ActivityFeed so the
 * feed's tap-through detail page and the activities list render the same run the
 * same way — two copies of this drifted apart once already.
 */

export interface Split {
  distance: number;
  duration: number;
  averagePace: number;
  averageHR: number | null;
  elevationGain: number | null;
  elevationLoss?: number | null;
}

export interface ActivityEntry {
  id: string;
  athlete_id: string;
  garmin_activity_id: number;
  activity_name: string;
  activity_type: string;
  start_time: string;
  distance: number;
  duration: number;
  moving_duration?: number;
  average_pace: number | null;
  average_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  elevation_gain: number | null;
  start_lat?: number | null;
  start_lng?: number | null;
  avg_cadence?: number | null;
  avg_stride_length?: number | null;
  vo2max?: number | null;
  lap_count?: number | null;
  location_name?: string | null;
  /** 1-10 effort and 0-4 feel, as logged by the athlete in the share sheet. */
  perceived_rpe?: number | null;
  perceived_feel?: number | null;
  /** Joined through athlete_activities.shoe_id. */
  shoe_name?: string | null;
  has_polyline?: boolean;
  gps_points?: Array<{ lat: number; lng: number }> | null;
  splits?: Split[] | null;
  athlete_name?: string;
}

export interface ActivityDetailsData {
  gpsPoints: Array<{ lat: number; lng: number }>;
  splits: Split[];
  /**
   * The activity row itself, so a caller that only has an id (the detail page,
   * arrived at from a feed card) doesn't need a second request. The list screens
   * already hold this and pass their own row instead.
   */
  activity?: ActivityEntry | null;
  /** Garmin-era per-activity summary. Present only for rows synced with it. */
  summary?: {
    calories?: number | null;
    averageRunCadence?: number | null;
    strideLength?: number | null;
    vO2MaxValue?: number | null;
    trainingEffect?: number | null;
    anaerobicTrainingEffect?: number | null;
    perceivedRpe?: number | null;
    perceivedFeel?: number | null;
  } | null;
}
