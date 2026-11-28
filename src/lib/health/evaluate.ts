/**
 * The verdict behind GET /api/health — pure, so the thresholds are tested without a database.
 *
 * Only ages and booleans leave this module: no row ids, emails, tokens or error text, because the
 * endpoint is public (an uptime checker has no session) and a health page that echoes a Postgres
 * error can leak a table name, a hint or a connection string fragment.
 */
export type HealthCheckName = 'db' | 'cron_tick' | 'garmin_sync' | 'strava_sync';
export type HealthState = 'ok' | 'stale' | 'down' | 'unknown';

export interface HealthInputs {
  now: Date;
  /** null = the DB query itself failed. */
  dbReachable: boolean;
  lastTickAt: string | null;
  lastGarminSyncAt: string | null;
  lastStravaSyncAt: string | null;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  checks: Record<HealthCheckName, { state: HealthState; ageMinutes: number | null; maxAgeMinutes: number | null }>;
}

/**
 * Max age before a timestamp counts as stale. cron/tick runs every 5 min (vercel.json), so 20 min
 * is three missed ticks. Sync runs every 5 min 02:00–21:59 UTC and not overnight, so a healthy
 * pipeline can sit idle ~5 h before the 02:00 run — 6 h covers the night without false alarms.
 */
export const HEALTH_MAX_AGE_MINUTES = { cron_tick: 20, garmin_sync: 6 * 60, strava_sync: 6 * 60 } as const;

function ageMinutes(now: Date, iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now.getTime() - t) / 60_000));
}

function freshness(now: Date, iso: string | null, max: number, dbReachable: boolean) {
  const age = ageMinutes(now, iso);
  const state: HealthState = !dbReachable || age === null ? 'unknown' : age > max ? 'stale' : 'ok';
  return { state, ageMinutes: age, maxAgeMinutes: max };
}

export function evaluateHealth(i: HealthInputs): HealthReport {
  const checks: HealthReport['checks'] = {
    db: { state: i.dbReachable ? 'ok' : 'down', ageMinutes: null, maxAgeMinutes: null },
    cron_tick: freshness(i.now, i.lastTickAt, HEALTH_MAX_AGE_MINUTES.cron_tick, i.dbReachable),
    garmin_sync: freshness(i.now, i.lastGarminSyncAt, HEALTH_MAX_AGE_MINUTES.garmin_sync, i.dbReachable),
    strava_sync: freshness(i.now, i.lastStravaSyncAt, HEALTH_MAX_AGE_MINUTES.strava_sync, i.dbReachable),
  };
  const status: HealthReport['status'] = !i.dbReachable
    ? 'down'
    : Object.values(checks).some((c) => c.state !== 'ok')
      ? 'degraded'
      : 'ok';
  return { status, checkedAt: i.now.toISOString(), checks };
}
