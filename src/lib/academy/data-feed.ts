import { connectionState, type ConnectionState } from '@/lib/providers/health';

/**
 * Is the trainee's data still arriving? (Missing-data rule: never a confident number on
 * data that stopped coming.)
 *
 * A Garmin credential that failed, or a watch that has not synced for days, leaves the
 * engine with a history that simply ends: fitness decays, fatigue decays faster, and the
 * home prints "+22 רענן · רענן ומוכן" for a trainee whose runs never reached us. Every
 * screen that prints a load number, a night or a "not done" asks this first.
 *
 * - Runs come from Garmin or Strava: the feed is broken only when EVERY connected provider
 *   is (a trainee on Strava whose Garmin died still has runs).
 * - Nights (sleep, resting HR) come from Garmin only.
 * - A trainee with neither (manual, Apple) has no feed to break: `none`.
 *
 * Pure: the route reads the athlete row (`DATA_FEED_COLUMNS`), this decides.
 */

export type FeedProvider = 'garmin' | 'strava';

export type DataFeed =
  | { kind: 'ok'; provider: FeedProvider }
  /** The provider refused the credential: reconnect in the profile. */
  | { kind: 'failed'; provider: FeedProvider; days: number | null }
  /** Nothing synced for `days` days. */
  | { kind: 'stale'; provider: FeedProvider; days: number }
  /** No provider connected (manual, Apple, or nothing yet). */
  | { kind: 'none' };

/**
 * Garmin is stamped by the sync cron whenever Garmin answers, runs or not
 * (garmin/sync-activities), so three days without a stamp is a sync that stopped — not a
 * trainee who took days off. Strava is only stamped when the member's own phone opens the
 * app, so it keeps the profile's 14 days (providers/health.ts STALE_AFTER_DAYS).
 */
export const GARMIN_STALE_DAYS = 3;
export const STRAVA_STALE_DAYS = 14;

export const DATA_FEED_COLUMNS =
  'garmin_auth, strava_auth, garmin_last_sync_at, garmin_auth_failed_at, strava_last_sync_at, strava_auth_failed_at';
/** Before migration 101: only whether a credential is stored. */
export const DATA_FEED_COLUMNS_FALLBACK = 'garmin_auth, strava_auth';

export interface FeedRow {
  garmin_auth?: unknown;
  strava_auth?: unknown;
  garmin_last_sync_at?: string | null;
  garmin_auth_failed_at?: string | null;
  strava_last_sync_at?: string | null;
  strava_auth_failed_at?: string | null;
}

const DAY = 86_400_000;
const daysSince = (iso: string | null | undefined, now: number) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null;
};

function providerFeed(row: FeedRow, provider: FeedProvider, now: number): DataFeed | null {
  const hasAuth = !!row[`${provider}_auth`];
  if (!hasAuth) return null;
  const lastSyncAt = row[`${provider}_last_sync_at`] ?? null;
  const authFailedAt = row[`${provider}_auth_failed_at`] ?? null;
  const state: ConnectionState = connectionState({ hasAuth, lastSyncAt, authFailedAt }, now);
  if (state === 'failed') return { kind: 'failed', provider, days: daysSince(lastSyncAt, now) ?? daysSince(authFailedAt, now) };
  const days = daysSince(lastSyncAt, now);
  const limit = provider === 'garmin' ? GARMIN_STALE_DAYS : STRAVA_STALE_DAYS;
  if (days != null && days >= limit) return { kind: 'stale', provider, days };
  // 'unknown' (never stamped, or before 101) reads as working: a fresh deploy must not
  // accuse every account of being broken.
  return { kind: 'ok', provider };
}

/** Whether runs are still arriving. */
export function runFeed(row: FeedRow | null | undefined, now: number = Date.now()): DataFeed {
  if (!row) return { kind: 'none' };
  const feeds = (['garmin', 'strava'] as const).map(p => providerFeed(row, p, now)).filter((f): f is DataFeed => !!f);
  if (!feeds.length) return { kind: 'none' };
  return feeds.find(f => f.kind === 'ok') ?? feeds[0];
}

/** Whether nights (sleep, resting HR) are still arriving: Garmin only. */
export function nightFeed(row: FeedRow | null | undefined, now: number = Date.now()): DataFeed {
  if (!row) return { kind: 'none' };
  return providerFeed(row, 'garmin', now) ?? { kind: 'none' };
}

export const feedBroken = (f: DataFeed | null | undefined): f is Extract<DataFeed, { kind: 'failed' | 'stale' }> =>
  !!f && (f.kind === 'failed' || f.kind === 'stale');

/** Can the coach push a workout to this trainee's watch? Garmin connected and not refused. */
export function canReceiveWatch(row: FeedRow | null | undefined, now: number = Date.now()): boolean {
  const f = row ? providerFeed(row, 'garmin', now) : null;
  return !!f && f.kind !== 'failed';
}
