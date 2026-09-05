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
  /** Detailed activity only — the list response omits it. */
  calories?: number;
  /** Detailed activity only: the caption the athlete typed on Strava. */
  description?: string | null;
  map?: { summary_polyline?: string | null };
  start_latlng?: [number, number] | null;
  end_latlng?: [number, number] | null;
  /** Detailed activity only: Strava's auto per-km splits. */
  splits_metric?: StravaSplit[];
}

export interface StravaSplit {
  split: number;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  average_speed: number;
  average_heartrate?: number;
  elevation_difference?: number;
  pace_zone?: number;
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

/**
 * Origin used for post-OAuth browser redirects.
 * A copied production .env still has NEXT_PUBLIC_APP_URL=https://madregot.tal.bo;
 * when the request itself is localhost, stay local so login does not bounce to prod.
 */
export function resolveAppOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  if (requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1') {
    return requestUrl.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || requestUrl.origin;
}

/** redirect_uri sent to Strava. Localhost always uses this host, not the prod callback. */
export function resolveStravaRedirectUri(request: Request): string {
  const origin = resolveAppOrigin(request);
  const hostname = new URL(origin).hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${origin}/api/strava/callback`;
  }
  return (
    process.env.STRAVA_REDIRECT_URI ||
    `${origin}/api/strava/callback`
  );
}

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

/**
 * A non-2xx from Strava, carrying the status.
 *
 * The status is the difference between three outcomes that a plain Error makes
 * indistinguishable: 404 means the activity is gone and no amount of retrying
 * will bring it back, 429 means stop asking right now, and anything else is
 * worth one more attempt later. A backfill that cannot tell them apart either
 * retries a deleted activity forever or gives up on a rate limit — see
 * lib/strava/backfill-laps.ts.
 */
export class StravaApiError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`Strava API error: ${status} - ${body}`);
    this.name = 'StravaApiError';
  }
}

/** The status of a Strava failure, if that is what this is. */
export function stravaErrorStatus(error: unknown): number | null {
  return error instanceof StravaApiError ? error.status : null;
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
      // Message kept byte-identical to the string this used to throw, so any log
      // grep or test matching on it still matches.
      throw new StravaApiError(response.status, await response.text());
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

/**
 * Turn Strava's auto per-km splits into the lap shape the rest of the app
 * consumes. Used when the watch recorded no manual/auto laps, so the actuals
 * card still shows the same per-km breakdown Strava does. Empty/invalid
 * splits are dropped; a single split is not worth a laps row.
 */
export function splitsToLaps(splits: StravaSplit[] | null | undefined): StravaLap[] {
  if (!Array.isArray(splits)) return [];
  const laps = splits
    .filter((s) => s && Number.isFinite(s.distance) && s.distance > 0 && Number.isFinite(s.moving_time) && s.moving_time > 0)
    .map((s, index) => {
      const movingTime = s.moving_time;
      const averageSpeed = Number.isFinite(s.average_speed) && s.average_speed > 0
        ? s.average_speed
        : s.distance / movingTime;
      return {
        name: `Split ${index + 1}`,
        lap_index: index + 1,
        split: s.split ?? index + 1,
        distance: s.distance,
        moving_time: movingTime,
        elapsed_time: Number.isFinite(s.elapsed_time) ? s.elapsed_time : movingTime,
        average_speed: averageSpeed,
        ...(Number.isFinite(s.average_heartrate) ? { average_heartrate: s.average_heartrate } : {}),
      } satisfies StravaLap;
    });
  return laps.length > 1 ? laps : [];
}

/** A laps payload that carries per-segment information worth rendering. */
export function hasUsefulLaps(laps: StravaLap[] | null | undefined): boolean {
  return Array.isArray(laps) && laps.length > 1;
}

export function getStravaActivityUrl(activityId: number): string {
  return `https://www.strava.com/activities/${activityId}`;
}

export function stravaAuthEmail(stravaAthleteId: number): string {
  return `strava_${stravaAthleteId}@strava.madregot.local`;
}

export function formatPace(metersPerSecond: number): string {
  if (!metersPerSecond) return '—';
  // Round the total first; rounding the remainder alone can yield "3:60".
  const secondsPerKm = Math.round(1000 / metersPerSecond);
  const minutes = Math.floor(secondsPerKm / 60);
  return `${minutes}:${(secondsPerKm % 60).toString().padStart(2, '0')}`;
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
