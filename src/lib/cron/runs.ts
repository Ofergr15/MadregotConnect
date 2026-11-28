// Cron observability (round-4 task 93, migration 251): every cron writes one `cron_runs` row —
// start, end, the response's top-level counts, and the error if it threw. Best-effort by
// design: a missing table (251 not applied) or a failed write never changes what the cron does
// or returns. An unauthenticated call (wrong/missing CRON_SECRET) writes nothing, so the table
// can't be filled by anyone probing the URL.
import { createServerClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/supabase/schema-drift';

export const CRON_RUNS_TABLE = 'cron_runs';
export const KEEP_DAYS = 30;
const ERROR_MAX = 500;

type Db = ReturnType<typeof createServerClient>;

/** The numbers and flags at the top level of a cron's JSON reply — its "counts". Nested data and strings are dropped. */
export function countsOf(body: unknown): Record<string, number | boolean> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const out: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[`${k}Count`] = v.length;
  }
  return Object.keys(out).length ? out : null;
}

export function errorText(err: unknown): string {
  const s = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return s.slice(0, ERROR_MAX);
}

/** Would this request pass the cron's own CRON_SECRET check? (Same rule the crons use: open when unset.) */
export function cronAuthorized(request: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return true;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

async function startRow(db: Db, name: string): Promise<string | null> {
  try {
    const { data, error } = await db.from(CRON_RUNS_TABLE).insert({ name, started_at: new Date().toISOString() }).select('id').single();
    if (error) { if (!isMissingTable(error)) console.error(`[cron-runs] start ${name} failed:`, error); return null; }
    return (data as { id: string }).id;
  } catch (e) { console.error(`[cron-runs] start ${name} failed:`, e); return null; }
}

async function finishRow(db: Db, id: string, name: string, patch: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await db.from(CRON_RUNS_TABLE).update({ ...patch, finished_at: new Date().toISOString() }).eq('id', id);
    if (error) console.error(`[cron-runs] finish ${name} failed:`, error);
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
    await db.from(CRON_RUNS_TABLE).delete().eq('name', name).lt('started_at', cutoff);
  } catch (e) { console.error(`[cron-runs] finish ${name} failed:`, e); }
}

/**
 * Wrap a cron route handler: `export const GET = withCronRun('badges', run)`. The reply is
 * returned untouched; a thrown error is recorded and re-thrown.
 */
export function withCronRun<R extends Request, A extends unknown[]>(name: string, handler: (request: R, ...rest: A) => Promise<Response>) {
  return async (request: R, ...rest: A): Promise<Response> => {
    if (!cronAuthorized(request)) return handler(request, ...rest);
    const db = createServerClient();
    const id = await startRow(db, name);
    try {
      const res = await handler(request, ...rest);
      if (id) {
        const body = await res.clone().json().catch(() => null);
        await finishRow(db, id, name, { ok: res.ok, http_status: res.status, counts: countsOf(body) });
      }
      return res;
    } catch (err) {
      if (id) await finishRow(db, id, name, { ok: false, http_status: 500, error: errorText(err) });
      throw err;
    }
  };
}

export interface CronRunRow { name: string; started_at: string; finished_at: string | null; ok: boolean | null; http_status: number | null; counts: unknown; error: string | null }

/** Last run per cron + whether one is still open (started, never finished — killed or running). */
export function summarizeRuns(rows: CronRunRow[]): Array<{ name: string; last: CronRunRow; open: boolean; failedRecently: number }> {
  const by = new Map<string, CronRunRow[]>();
  for (const r of rows) (by.get(r.name) ?? by.set(r.name, []).get(r.name)!).push(r);
  return [...by.entries()].map(([name, rs]) => {
    const sorted = [...rs].sort((a, b) => b.started_at.localeCompare(a.started_at));
    return { name, last: sorted[0], open: sorted[0].finished_at == null, failedRecently: sorted.filter((r) => r.ok === false).length };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
