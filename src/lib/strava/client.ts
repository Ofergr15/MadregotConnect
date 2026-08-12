/**
 * Strava API client — ported/adapted from RunGPT `lib/strava.ts`,
 * plus streams → GPX / gps_points for run-chat actuals.
 */

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

export interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete_id: number;
}

export interface StravaAthlete {
  id: number;
  username?: string;
  firstname?: string;
  lastname?: string;
  city?: string;
  state?: string;
  country?: string;
  profile?: string;
  profile_medium?: string;
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date: string;
  start_date_local: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_speed: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  calories?: number;
  map?: { summary_polyline?: string | null };
  start_latlng?: [number, number] | null;
  end_latlng?: [number, number] | null;
}

export interface StravaLap {
  id?: number;
  index?: number;
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time?: number;
  average_speed: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  lap_index: number;
  split?: number;
}

export type StravaStreams = {
  latlng?: { data: [number, number][] };
  time?: { data: number[] };
  altitude?: { data: number[] };
  heartrate?: { data: number[] };
  velocity_smooth?: { data: number[] };
  cadence?: { data: number[] };
};

export async function refreshStravaToken(refreshToken: string): Promise<StravaTokens | null> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    if (!response.ok) {
      console.error('Failed to refresh Strava token:', await response.text());
      return null;
    }
    const data = await response.json();
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      athlete_id: data.athlete?.id ?? 0,
    };
  } catch (error) {
    console.error('Error refreshing Strava token:', error);
    return null;
  }
}

export function tokenNeedsRefresh(expiresAt: number): boolean {
  return Date.now() / 1000 > expiresAt - 300;
}

export class StravaClient {
  constructor(private accessToken: string) {}

  private async fetchJson<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${STRAVA_API_BASE}${endpoint}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.append(key, String(value));
      }
    }
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Strava API error: ${response.status} - ${error}`);
    }
    return response.json();
  }

  getAthlete(): Promise<StravaAthlete> {
    return this.fetchJson<StravaAthlete>('/athlete');
  }

  getActivities(params?: {
    before?: number;
    after?: number;
    page?: number;
    per_page?: number;
  }): Promise<StravaActivity[]> {
    return this.fetchJson<StravaActivity[]>('/athlete/activities', params as Record<string, string | number>);
  }

  async getAllActivities(options?: {
    maxPages?: number;
    perPage?: number;
    after?: number;
    before?: number;
  }): Promise<StravaActivity[]> {
    const maxPages = options?.maxPages ?? 10;
    const perPage = options?.perPage ?? 100;
    const all: StravaActivity[] = [];
    let page = 1;
    while (page <= maxPages) {
      const params: { page: number; per_page: number; after?: number; before?: number } = {
        page,
        per_page: perPage,
      };
      if (options?.after) params.after = options.after;
      if (options?.before) params.before = options.before;
      const batch = await this.getActivities(params);
      if (!batch?.length) break;
      all.push(...batch);
      if (batch.length < perPage) break;
      page++;
    }
    return all;
  }

  getActivity(activityId: number): Promise<StravaActivity> {
    return this.fetchJson<StravaActivity>(`/activities/${activityId}`, {
      include_all_efforts: 'true',
    });
  }

  getActivityLaps(activityId: number): Promise<StravaLap[]> {
    return this.fetchJson<StravaLap[]>(`/activities/${activityId}/laps`);
  }

  /**
   * Stream sets for an activity. Prefer key_by_type for stable object shape.
   */
  getActivityStreams(
    activityId: number,
    keys = 'latlng,time,altitude,heartrate,velocity_smooth,cadence',
  ): Promise<StravaStreams> {
    return this.fetchJson<StravaStreams>(`/activities/${activityId}/streams`, {
      keys,
      key_by_type: 'true',
    });
  }
}

/** Fetch laps; null on error (callers can skip). */
export async function fetchStravaLaps(
  activityId: number,
  accessToken: string,
): Promise<StravaLap[] | null> {
  try {
    return await new StravaClient(accessToken).getActivityLaps(activityId);
  } catch {
    return null;
  }
}

export function getStravaActivityUrl(activityId: number): string {
  return `https://www.strava.com/activities/${activityId}`;
}

export function stravaAuthEmail(stravaAthleteId: number): string {
  return `strava_${stravaAthleteId}@strava.madregot.local`;
}

export function formatPace(metersPerSecond: number): string {
  if (!metersPerSecond) return '—';
  const minutesPerKm = 1000 / (metersPerSecond * 60);
  const minutes = Math.floor(minutesPerKm);
  const seconds = Math.round((minutesPerKm - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function streamsToGpsPoints(streams: StravaStreams): Array<{ lat: number; lng: number }> {
  const latlng = streams.latlng?.data;
  if (!latlng?.length) return [];
  return latlng.map(([lat, lng]) => ({ lat, lng }));
}

export function streamsToGpx(
  streams: StravaStreams,
  meta: { name: string; startTimeIso: string; activityId: number },
): string {
  const latlng = streams.latlng?.data || [];
  const times = streams.time?.data || [];
  const alts = streams.altitude?.data || [];
  const startMs = new Date(meta.startTimeIso).getTime();

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const pts = latlng.map(([lat, lng], i) => {
    const t = Number.isFinite(times[i])
      ? new Date(startMs + times[i] * 1000).toISOString()
      : null;
    const ele = Number.isFinite(alts[i]) ? `<ele>${alts[i].toFixed(1)}</ele>` : '';
    const time = t ? `<time>${t}</time>` : '';
    return `<trkpt lat="${lat}" lon="${lng}">${ele}${time}</trkpt>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MadregotConnect" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escape(meta.name)}</name>
    <time>${escape(meta.startTimeIso)}</time>
    <link href="${getStravaActivityUrl(meta.activityId)}"/>
  </metadata>
  <trk>
    <name>${escape(meta.name)}</name>
    <trkseg>
      ${pts.join('\n      ')}
    </trkseg>
  </trk>
</gpx>
`;
}
