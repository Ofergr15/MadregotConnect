/**
 * The native app's "watch & data sources" screen — the pure half.
 *
 * Every route under `/api/me/data-sources` is SELF-ONLY: identity comes from the
 * Supabase JWT (`requireAthlete`) and never from a body or query field, because
 * these routes start and end someone's Garmin/Strava connection, and nobody — not
 * a coach, not an admin — needs to do that on another member's behalf.
 *
 * The encrypted `garmin_auth` blob never leaves the server here: the ticket or the
 * password goes in, the server writes the column itself, and the response is
 * booleans and timestamps. (`/api/garmin/ticket-auth` and `/api/garmin/authenticate`
 * still hand the blob to the PWA — unchanged on purpose, a separate decision.)
 */
import { connectionState, type ConnectionState } from '@/lib/providers/health';

/** The custom URL scheme the iOS app registers (ios/Config/Info.plist). */
export const NATIVE_SCHEME = 'madregot';

/** Where the app's ASWebAuthenticationSession is sent back to after Garmin's SSO. */
export const NATIVE_GARMIN_RETURN = `${NATIVE_SCHEME}://data-sources/garmin`;
export const NATIVE_STRAVA_RETURN = `${NATIVE_SCHEME}://data-sources/strava`;

/** Strava `state` prefix for a connect started from the native app. */
export const NATIVE_STRAVA_STATE_PREFIX = 'app:';

/**
 * The `service=` URL handed to Garmin's SSO. Garmin's sign-in page accepts any
 * service URL (spike 2026-11-21: it renders the form for madregot.app and for an
 * unrelated host alike) and redirects to it with `?ticket=`. Our callback then
 * bounces to the app's scheme.
 */
export function garminNativeServiceUrl(appOrigin: string): string {
  return `${appOrigin.replace(/\/$/, '')}/api/garmin/sso-callback/app`;
}

export function garminSsoSignInUrl(service: string): string {
  const p = new URLSearchParams({
    service,
    // `clientId` and `locale` only shape Garmin's page; the ticket does not depend on them.
    clientId: 'GarminConnect',
    locale: 'he',
  });
  return `https://sso.garmin.com/sso/signin?${p.toString()}`;
}

/** A Garmin SSO ticket: "ST-" + an opaque id. Shape-checked so junk never reaches Garmin. */
export function isPlausibleGarminTicket(ticket: unknown): ticket is string {
  return typeof ticket === 'string' && /^ST-[A-Za-z0-9._-]{8,200}$/.test(ticket);
}

/** Strava link state for the app: `app:<athleteId>`, or null when it isn't one. */
export function nativeStravaAthleteId(state: string | null): string | null {
  if (!state || !state.startsWith(NATIVE_STRAVA_STATE_PREFIX)) return null;
  const id = state.slice(NATIVE_STRAVA_STATE_PREFIX.length);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

// ── Status ───────────────────────────────────────────────────────────────────

/** The three states the screen draws, plus "not connected". */
export type NativeProviderState = 'connected' | 'needs_reauth' | 'provider_down' | 'not_connected';

/**
 * `providers/health.ts` answers "does the credential work"; the screen asks a
 * slightly different question. `stale` is not "Garmin is down" — it's "nothing
 * arrived in two weeks", which for a runner on a break is normal — so it maps to
 * `connected` and the 3-day nudge (client side, from `lastRunAt`) carries that
 * story instead. `provider_down` is only ever set by a sync that failed for a
 * reason other than auth, which we learn from `syncError` on the sync-now call.
 */
export function nativeState(s: ConnectionState): NativeProviderState {
  switch (s) {
    case 'none': return 'not_connected';
    case 'failed': return 'needs_reauth';
    default: return 'connected';
  }
}

export interface AthleteSourceRow {
  garmin_auth?: string | null;
  strava_auth?: string | null;
  data_source?: string | null;
  garmin_last_sync_at?: string | null;
  garmin_auth_failed_at?: string | null;
  strava_last_sync_at?: string | null;
  strava_auth_failed_at?: string | null;
  // Migration 192 — absent before it is applied.
  garmin_connected_at?: string | null;
  garmin_connected_via?: string | null;
  strava_connected_at?: string | null;
}

export interface RecentRun {
  id: string;
  name: string | null;
  startTime: string;
  distanceM: number | null;
  durationS: number | null;
  source: string | null;
}

export interface ProviderStatus {
  state: NativeProviderState;
  lastSyncAt: string | null;
  /** Garmin's 5-minute cron; Strava has no schedule (null). */
  nextSyncAt: string | null;
  connectedAt: string | null;
  connectedVia: 'sso' | 'password' | 'oauth' | null;
}

export interface HistoryProgress {
  state: 'none' | 'importing' | 'complete';
  imported: number;
  /** YYYY-MM of the oldest run reached so far. */
  reachedMonth: string | null;
}

export interface DataSourcesPayload {
  garmin: ProviderStatus;
  strava: ProviderStatus;
  /** Garmin whenever it's connected — dedup upgrades to Garmin's copy anyway. */
  primary: 'garmin' | 'strava' | null;
  lastRunAt: string | null;
  recentRuns: RecentRun[];
  history: HistoryProgress;
}

/**
 * `/api/cron/sync` fires every 5 minutes (02–21 UTC, vercel.json) but walks the
 * club stalest-first under a time budget, so one athlete isn't reached every round.
 * 15 minutes is an estimate, labelled as one ("בעוד כ-") on the screen.
 */
export const GARMIN_SYNC_INTERVAL_MIN = 15;

export function nextGarminSync(lastSyncAt: string | null, now: number): string | null {
  if (!lastSyncAt) return null;
  const last = Date.parse(lastSyncAt);
  if (Number.isNaN(last)) return null;
  const step = GARMIN_SYNC_INTERVAL_MIN * 60_000;
  let next = last + step;
  while (next <= now) next += step;
  return new Date(next).toISOString();
}

export function buildDataSourcesPayload(
  row: AthleteSourceRow,
  runs: RecentRun[],
  history: HistoryProgress,
  now: number = Date.now(),
): DataSourcesPayload {
  const g = connectionState({ hasAuth: !!row.garmin_auth, lastSyncAt: row.garmin_last_sync_at, authFailedAt: row.garmin_auth_failed_at }, now);
  const s = connectionState({ hasAuth: !!row.strava_auth, lastSyncAt: row.strava_last_sync_at, authFailedAt: row.strava_auth_failed_at }, now);
  const via = row.garmin_connected_via;
  const garmin: ProviderStatus = {
    state: nativeState(g),
    lastSyncAt: row.garmin_auth ? row.garmin_last_sync_at ?? null : null,
    nextSyncAt: row.garmin_auth ? nextGarminSync(row.garmin_last_sync_at ?? null, now) : null,
    connectedAt: row.garmin_auth ? row.garmin_connected_at ?? null : null,
    connectedVia: row.garmin_auth && (via === 'sso' || via === 'password') ? via : null,
  };
  const strava: ProviderStatus = {
    state: nativeState(s),
    lastSyncAt: row.strava_auth ? row.strava_last_sync_at ?? null : null,
    nextSyncAt: null,
    connectedAt: row.strava_auth ? row.strava_connected_at ?? null : null,
    connectedVia: row.strava_auth ? 'oauth' : null,
  };
  return {
    garmin,
    strava,
    primary: row.garmin_auth ? 'garmin' : row.strava_auth ? 'strava' : null,
    lastRunAt: runs[0]?.startTime ?? null,
    recentRuns: runs.slice(0, 3),
    history: row.garmin_auth ? history : { state: 'none', imported: 0, reachedMonth: null },
  };
}

// ── Sync now ─────────────────────────────────────────────────────────────────

export const SYNC_NOW_MIN_INTERVAL_MS = 60_000;

/**
 * One manual sync a minute. Keyed by athlete; the map is per-instance, so the
 * DB's own `*_last_sync_at` is checked too — together they stop a held-down button
 * from fanning out serial Garmin calls under the 300 s ceiling.
 */
export function syncNowRetryAfter(
  lastManualAt: number | undefined,
  lastSyncIso: Array<string | null | undefined>,
  now: number,
): number {
  const stamps = [lastManualAt ?? NaN, ...lastSyncIso.map((s) => (s ? Date.parse(s) : NaN))]
    .filter((t) => Number.isFinite(t));
  const latest = stamps.length ? Math.max(...stamps) : -Infinity;
  const wait = latest + SYNC_NOW_MIN_INTERVAL_MS - now;
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

// ── Disconnect ───────────────────────────────────────────────────────────────

export type DisconnectProvider = 'garmin' | 'strava';

/**
 * What to write. The credential goes to NULL (not a flag), the health stamps go
 * with it so the screen can't report a sync from a source that's gone, and
 * `data_source` moves only to a source that is actually still connected.
 * Activities are never touched.
 */
export function disconnectPatch(provider: DisconnectProvider, row: AthleteSourceRow): Record<string, unknown> {
  if (provider === 'garmin') {
    return {
      garmin_auth: null,
      garmin_last_sync_at: null,
      garmin_auth_failed_at: null,
      ...(row.strava_auth && row.data_source !== 'strava' ? { data_source: 'strava' } : {}),
    };
  }
  return {
    strava_auth: null,
    strava_athlete_id: null,
    strava_last_sync_at: null,
    strava_auth_failed_at: null,
    ...(row.garmin_auth && row.data_source === 'strava' ? { data_source: 'garmin' } : {}),
  };
}

/** Migration 192's columns, written only when present (graceful pre-migration). */
export const CONNECTED_AT_COLUMNS_192 = 'garmin_connected_at, garmin_connected_via, strava_connected_at';
