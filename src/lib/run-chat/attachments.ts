export const RUN_ATTACHMENT_VERSION = 1;
export const TOOL_TRACE_VERSION = 1;

export type RoutePoint = { lat: number; lng: number };

export type RunSummaryPayload = {
  id: string;
  strava_activity_id: number | null;
  name: string | null;
  date: string;
  distance_m: number;
  distance_km: number;
  duration_s: number;
  pace_s_per_km: number | null;
  pace: string | null;
  average_hr: number | null;
  max_hr: number | null;
  elevation_gain_m: number | null;
  average_cadence: number | null;
  lap_count: number;
};

export type StravaRunAttachment = {
  type: 'strava_run';
  version: number;
  run: RunSummaryPayload;
  strava_url: string | null;
  chat_url: string;
  gpx_url?: string | null;
  laps_image_url?: string | null;
  route_points?: RoutePoint[];
};

export type ToolTraceStatus = 'running' | 'complete' | 'error';

export type ToolTraceStep = {
  id: string;
  name: string;
  status: ToolTraceStatus;
  args: Record<string, unknown>;
  result?: string;
};

export type ToolTraceAttachment = {
  type: 'tool_trace';
  version: number;
  steps: ToolTraceStep[];
};

export function downsampleRoute(points: RoutePoint[] | null | undefined, max = 120): RoutePoint[] {
  if (!points?.length || points.length <= max) return points || [];
  const sampled: RoutePoint[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let index = 0; index < max; index += 1) {
    sampled.push(points[Math.round(index * step)]);
  }
  return sampled;
}
