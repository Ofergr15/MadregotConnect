/**
 * Whether a stored Garmin/Strava credential is actually still working.
 *
 * The profile screen used to answer that question with `!!garmin_auth` — i.e.
 * "somebody once connected", which is not the same claim at all. Nothing wrote a
 * failure anywhere, so a revoked Strava app or a changed Garmin password read as
 * "Connected" indefinitely and the athlete's activities simply stopped arriving.
 * Measured 2026-09-11 on prod: one row carrying a Strava credential that has
 * never produced a single activity, displaying "Connected".
 *
 * Migration 101 adds the two timestamps this needs. Everything here is written
 * from the sync routes, which are the only code that ever learns the answer.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type Provider = 'garmin' | 'strava';

/** Migration 101's columns as a PostgREST select fragment. */
export const PROVIDER_HEALTH_COLUMNS_101 =
  'garmin_last_sync_at, garmin_auth_failed_at, strava_last_sync_at, strava_auth_failed_at';

/**
 * How long a credential may go unsynced before the UI stops calling it healthy.
 *
 * Garmin is stamped by the 5-minute cron, so for that provider anything beyond a
 * day or two is already suspicious. Strava is not: the cron only repairs Strava
 * rows it already has, so a Strava stamp is written when the member's own phone
 * opens the app (see open-sync.ts) — which means "stale" there can also mean "has
 * not opened the app", and a threshold anywhere near the crons' cadence would
 * accuse half the club of a broken watch.
 *
 * A member can also be injured, travelling or simply not running, and telling them
 * their watch is broken because they took a week off would be worse than saying
 * nothing. Two weeks is past any normal gap and still well inside the point where
 * the athlete has noticed their runs are missing.
 */
export const STALE_AFTER_DAYS = 14;

export type ConnectionState =
  /** No credential stored — the "Connect" button. */
  | 'none'
  /**
   * Connected, but never stamped: either the pre-101 window, or a brand new
   * connection whose first sync hasn't finished. Renders as plain "Connected",
   * which is exactly what this screen said before 101 — a fresh deploy must not
   * accuse twenty working accounts of being broken.
   */
  | 'unknown'
  | 'ok'
  | 'stale'
  /** The provider refused the credential: the only state that asks for action. */
  | 'failed';

export interface ProviderHealthInput {
  hasAuth: boolean;
  lastSyncAt?: string | null;
  authFailedAt?: string | null;
}

export function connectionState(
  { hasAuth, lastSyncAt, authFailedAt }: ProviderHealthInput,
  now: number = Date.now(),
): ConnectionState {
  if (!hasAuth) return 'none';

  const failedAt = authFailedAt ? Date.parse(authFailedAt) : NaN;
  const syncedAt = lastSyncAt ? Date.parse(lastSyncAt) : NaN;

  // A failure only counts while it is the LATEST word on the credential. The
  // sync clears the flag on success, but ordering by timestamp too means a stale
  // flag left by a missing-column write, or a reconnect that hasn't synced yet,
  // can't pin a working account on "Reconnect needed".
  if (!Number.isNaN(failedAt) && (Number.isNaN(syncedAt) || failedAt > syncedAt)) return 'failed';

  if (Number.isNaN(syncedAt)) return 'unknown';
  return now - syncedAt > STALE_AFTER_DAYS * 86_400_000 ? 'stale' : 'ok';
}

/**
 * Whether a provider error means "this credential is dead" rather than "the
 * network hiccuped".
 *
 * Deliberately narrow. Flagging on any failure would mark every athlete during a
 * Garmin outage, and `failed` is the one state that tells a member to go and
 * re-enter their password — a false positive there costs them a pointless
 * reconnect, which is worse than one more quiet sync.
 */
export function looksLikeAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const status = (error as { status?: number; statusCode?: number } | null)?.status
    ?? (error as { statusCode?: number } | null)?.statusCode;
  if (status === 401 || status === 403) return true;
  return /\b401\b|\b403\b|unauthor|forbidden|invalid[_ ]grant|invalid[_ ]token|token.*(expired|invalid)|expired.*token|re-?auth|login required/i
    .test(message);
}

/** '42703' = Postgres undefined_column, 'PGRST204' = PostgREST's schema cache. */
function missingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /does not exist|schema cache/i.test(error.message || '')
  );
}

/**
 * Both writers below are best-effort and never throw.
 *
 * They run inside the sync loop, where the work that matters is storing runs.
 * Losing a health stamp costs the pill one hour of precision; throwing here
 * would cost an athlete their activities — and in the window before 101 is
 * pasted into the SQL editor, every one of these calls fails by definition.
 */
async function stamp(
  supabase: SupabaseClient,
  athleteId: string,
  updates: Record<string, string | null>,
): Promise<void> {
  try {
    const { error } = await supabase.from('athletes').update(updates).eq('id', athleteId);
    if (error && !missingColumn(error)) {
      console.warn(`Provider health stamp failed for ${athleteId}:`, error.message);
    }
  } catch (error) {
    console.warn(`Provider health stamp threw for ${athleteId}:`, error);
  }
}

/** The provider answered: record it, and retract any earlier failure. */
export function markProviderSynced(
  supabase: SupabaseClient,
  athleteId: string,
  provider: Provider,
): Promise<void> {
  return stamp(supabase, athleteId, {
    [`${provider}_last_sync_at`]: new Date().toISOString(),
    [`${provider}_auth_failed_at`]: null,
  });
}

/** The provider refused the credential. */
export function markProviderAuthFailed(
  supabase: SupabaseClient,
  athleteId: string,
  provider: Provider,
): Promise<void> {
  return stamp(supabase, athleteId, {
    [`${provider}_auth_failed_at`]: new Date().toISOString(),
  });
}
