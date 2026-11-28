/**
 * Staff status page data (task 165) — what GET /api/admin/status returns.
 *
 * Builds on GET /api/health (#211: DB reachability + tick/sync ages, public, ages only) and,
 * when it lands, `cron_runs` (#236). This one is staff-only, so it can carry counts:
 *
 *   providers  per provider: newest sync, connected, stale (no sync in 24 h), refused credential
 *   crons      last run / last failure / failures in 24 h per cron, from cron_runs; when that
 *              table isn't there yet, just the latest cron/tick heartbeat
 *   errors     last 24 h: client errors, server errors seen by clients, refused pushes, failed emails
 *   queues     overdue scheduled notifications, plan pushes pending/backing off/failed
 *
 * Every number is a COUNT (head:true) or one newest timestamp — no rows, names or error text
 * leave the server, same rule as /api/health. Each read is independent: one failing (a table
 * or column from an unapplied migration) turns into `null` for that number, never a 500.
 */

export const STALE_SYNC_MS = 24 * 3_600_000;
export const WINDOW_MS = 24 * 3_600_000;

type Res<T> = PromiseLike<{ data?: T | null; count?: number | null; error: { message: string; code?: string } | null }>;

interface Q<T = unknown> extends Res<T> {
  eq(c: string, v: unknown): Q<T>;
  neq(c: string, v: unknown): Q<T>;
  in(c: string, v: unknown[]): Q<T>;
  gte(c: string, v: string): Q<T>;
  lt(c: string, v: string): Q<T>;
  lte(c: string, v: string): Q<T>;
  not(c: string, op: string, v: unknown): Q<T>;
  order(c: string, o: { ascending: boolean }): Q<T>;
  limit(n: number): Q<T>;
}
export interface StatusDb {
  from(table: string): { select(cols: string, opts?: { count: 'exact'; head: true }): Q };
}

export interface ProviderStatus { lastSyncAt: string | null; connected: number | null; staleOver24h: number | null; credentialRefused: number | null }
export interface CronStatus { name: string; lastRunAt: string | null; lastOk: boolean | null; failuresLast24h: number }
export interface StatusReport {
  checkedAt: string;
  providers: { garmin: ProviderStatus; strava: ProviderStatus };
  crons: { source: 'cron_runs' | 'tick_heartbeat'; lastTickAt: string | null; runs: CronStatus[] };
  errors24h: { clientErrors: number | null; apiErrors: number | null; pushRefused: number | null; emailFailed: number | null };
  queues: { notificationsOverdue: number | null; planPushPending: number | null; planPushBackoff: number | null; planPushFailed: number | null };
}

async function count(q: Q): Promise<number | null> {
  try {
    const { count: n, error } = await q;
    return error ? null : (n ?? 0);
  } catch {
    return null;
  }
}

async function newest(q: Q, col: string): Promise<string | null> {
  try {
    const { data, error } = await q.order(col, { ascending: false }).limit(1);
    if (error) return null;
    const row = (data as Record<string, string | null>[] | null)?.[0];
    return row?.[col] ?? null;
  } catch {
    return null;
  }
}

const head = { count: 'exact' as const, head: true as const };

async function provider(db: StatusDb, p: 'garmin' | 'strava', nowMs: number): Promise<ProviderStatus> {
  const last = `${p}_last_sync_at`;
  const staleBefore = new Date(nowMs - STALE_SYNC_MS).toISOString();
  const [lastSyncAt, connected, staleOver24h, credentialRefused] = await Promise.all([
    newest(db.from('athletes').select(last).not(last, 'is', null), last),
    count(db.from('athletes').select('id', head).eq('status', 'active').not(last, 'is', null)),
    count(db.from('athletes').select('id', head).eq('status', 'active').lt(last, staleBefore)),
    // Migration 101's column; null (not 0) when it isn't applied.
    count(db.from('athletes').select('id', head).eq('status', 'active').not(`${p}_auth_failed_at`, 'is', null)),
  ]);
  return { lastSyncAt, connected, staleOver24h, credentialRefused };
}

/** Folds cron_runs rows (newest first) into one line per cron. Pure. */
export function foldCronRuns(rows: { name: string; started_at: string; ok: boolean | null }[], nowMs: number): CronStatus[] {
  const since = nowMs - WINDOW_MS;
  const by = new Map<string, CronStatus>();
  for (const r of rows) {
    let s = by.get(r.name);
    if (!s) {
      s = { name: r.name, lastRunAt: r.started_at, lastOk: r.ok, failuresLast24h: 0 };
      by.set(r.name, s);
    }
    if (r.ok === false && Date.parse(r.started_at) >= since) s.failuresLast24h++;
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function crons(db: StatusDb, nowMs: number): Promise<StatusReport['crons']> {
  const lastTickAt = await newest(db.from('cron_tick_locks').select('tick_at'), 'tick_at');
  try {
    const { data, error } = await db.from('cron_runs').select('name, started_at, ok')
      .gte('started_at', new Date(nowMs - WINDOW_MS).toISOString())
      .order('started_at', { ascending: false }).limit(2000);
    if (!error) {
      return { source: 'cron_runs', lastTickAt, runs: foldCronRuns((data || []) as { name: string; started_at: string; ok: boolean | null }[], nowMs) };
    }
  } catch { /* fall through */ }
  return { source: 'tick_heartbeat', lastTickAt, runs: [] };
}

export async function collectStatus(db: StatusDb, nowMs = Date.now()): Promise<StatusReport> {
  const since = new Date(nowMs - WINDOW_MS).toISOString();
  const now = new Date(nowMs).toISOString();
  const [garmin, strava, cronStatus, clientErrors, apiErrors, pushRefused, emailFailed, notificationsOverdue, planPushPending, planPushBackoff, planPushFailed] = await Promise.all([
    provider(db, 'garmin', nowMs),
    provider(db, 'strava', nowMs),
    crons(db, nowMs),
    count(db.from('client_events').select('id', head).eq('kind', 'error').gte('created_at', since)),
    count(db.from('client_events').select('id', head).eq('kind', 'api_error').gte('created_at', since)),
    count(db.from('push_deliveries').select('id', head).eq('accepted', false).gte('sent_at', since)),
    count(db.from('email_log').select('id', head).in('status', ['refused', 'failed', 'bounced', 'complained']).gte('created_at', since)),
    // Due by now and still waiting: the per-minute notifications cron is behind (or failing).
    // Five minutes of grace so a row due this minute isn't "overdue".
    count(db.from('scheduled_notifications').select('id', head).eq('status', 'scheduled').lte('next_run_at', new Date(nowMs - 5 * 60_000).toISOString())),
    count(db.from('plan_push_status').select('athlete_id', head).eq('state', 'pending')),
    count(db.from('plan_push_status').select('athlete_id', head).eq('state', 'backoff')),
    count(db.from('plan_push_status').select('athlete_id', head).eq('state', 'failed').gte('updated_at', since)),
  ]);
  return {
    checkedAt: now,
    providers: { garmin, strava },
    crons: cronStatus,
    errors24h: { clientErrors, apiErrors, pushRefused, emailFailed },
    queues: { notificationsOverdue, planPushPending, planPushBackoff, planPushFailed },
  };
}
