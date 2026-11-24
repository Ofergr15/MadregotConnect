import { addDaysToDateStr } from '@/lib/utils';

/**
 * Staff data-check (b23): "is this runner's data reaching us?" — the last 14 days, one
 * cell each, plus a short list of checks and one headline. Pure; the route
 * (app/api/admin/data-check) feeds it.
 *
 * Connection state arrives as BOOLEANS and timestamps only. The credential itself is
 * read server-side to answer "connected?" and never enters this module, so nothing here
 * can serialise it.
 */

export type DayState = 'synced' | 'missing' | 'noWatch';
export type CheckKey = 'provider' | 'garminAuth' | 'stravaAuth' | 'recentSync' | 'recentActivity';
export type Headline = 'ok' | 'noProvider' | 'authFailed' | 'staleSync' | 'noRecentRuns';

export interface ProviderState {
  connected: boolean;
  lastSyncAt: string | null;
  authFailedAt: string | null;
}

export interface DataCheckInput {
  /** Israel calendar day, YYYY-MM-DD. */
  today: string;
  /** Local calendar dates (activityLocalDateStr) of the runner's recorded activities. */
  activityDates: string[];
  garmin: ProviderState;
  strava: ProviderState;
  now?: Date;
}

export interface DataCheck {
  key: CheckKey;
  ok: boolean;
  /** An ISO timestamp or a date the screen can render beside the check, when there is one. */
  at: string | null;
}

export interface DataCheckResult {
  days14: Array<{ date: string; state: DayState }>;
  checks: DataCheck[];
  headline: Headline;
  lastActivityDate: string | null;
}

/** A sync older than this is stale — the hourly cron should have touched it many times. */
export const STALE_SYNC_HOURS = 26;
/** No run at all in this many days, while connected, is worth a look. */
export const QUIET_DAYS = 7;

const failing = (p: ProviderState) => p.connected && !!p.authFailedAt
  && (!p.lastSyncAt || Date.parse(p.authFailedAt) >= Date.parse(p.lastSyncAt));

export function buildDataCheck(input: DataCheckInput): DataCheckResult {
  const { today, garmin, strava } = input;
  const now = input.now ?? new Date();
  const ran = new Set(input.activityDates);
  const anyProvider = garmin.connected || strava.connected;

  const days14 = Array.from({ length: 14 }, (_, i) => {
    const date = addDaysToDateStr(today, i - 13);
    const state: DayState = ran.has(date) ? 'synced' : anyProvider ? 'missing' : 'noWatch';
    return { date, state };
  });

  const lastActivityDate = [...ran].filter((d) => d <= today).sort().pop() ?? null;
  const syncs = [garmin, strava].filter((p) => p.connected && p.lastSyncAt).map((p) => p.lastSyncAt as string);
  const lastSync = syncs.sort().pop() ?? null;
  // NULL last-sync = "not stamped yet" (migration 101) — not stale.
  const syncOk = !anyProvider || !lastSync || now.getTime() - Date.parse(lastSync) <= STALE_SYNC_HOURS * 3600_000;
  const quietSince = addDaysToDateStr(today, -(QUIET_DAYS - 1));
  const recentOk = !anyProvider || (!!lastActivityDate && lastActivityDate >= quietSince);

  const checks: DataCheck[] = [
    { key: 'provider', ok: anyProvider, at: null },
    ...(garmin.connected ? [{ key: 'garminAuth' as const, ok: !failing(garmin), at: failing(garmin) ? garmin.authFailedAt : garmin.lastSyncAt }] : []),
    ...(strava.connected ? [{ key: 'stravaAuth' as const, ok: !failing(strava), at: failing(strava) ? strava.authFailedAt : strava.lastSyncAt }] : []),
    { key: 'recentSync', ok: syncOk, at: lastSync },
    { key: 'recentActivity', ok: recentOk, at: lastActivityDate },
  ];

  const headline: Headline = !anyProvider ? 'noProvider'
    : failing(garmin) || failing(strava) ? 'authFailed'
    : !syncOk ? 'staleSync'
    : !recentOk ? 'noRecentRuns'
    : 'ok';

  return { days14, checks, headline, lastActivityDate };
}
