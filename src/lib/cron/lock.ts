import { randomUUID } from 'node:crypto';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Overlap lock for crons: at most one run of a named job at a time.
 *
 * Backed by migration 355 — an advisory lock serialises the acquire, a lease row
 * with an expiry holds it for the run (see the migration for why a bare session
 * advisory lock cannot work through PostgREST). The TTL must exceed the route's
 * maxDuration so a live run never loses its lease, and stays short enough that a
 * run the platform killed frees the lock by the next tick or the one after.
 *
 * FAILS OPEN: if the rpc errors (migration not applied, database hiccup) the job
 * runs unlocked, exactly as it did before this existed. Skipping a sync because
 * the lock table was unreachable would be worse than the overlap it prevents.
 */

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
export type LockDb = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult> };

export type LockOutcome<T> =
  | { ran: true; locked: boolean; value: T }
  | { ran: false; reason: 'held' };

export async function withCronLock<T>(
  name: string,
  ttlSeconds: number,
  job: () => Promise<T>,
  opts: { db?: LockDb; holder?: string } = {},
): Promise<LockOutcome<T>> {
  const holder = opts.holder ?? randomUUID();
  let db: LockDb | null = opts.db ?? null;
  let locked = false;
  try {
    db ??= createServerClient() as unknown as LockDb;
    const { data, error } = await db.rpc('cron_lock_acquire', { p_name: name, p_holder: holder, p_ttl_seconds: ttlSeconds });
    if (error) {
      console.error(`[cron-lock] acquire ${name} failed, running unlocked`, error.code ?? '', error.message ?? '');
    } else if (data === false) {
      console.log(`[cron-lock] ${name} is held by another run, skipping`);
      return { ran: false, reason: 'held' };
    } else {
      locked = data === true;
    }
  } catch (e) {
    console.error(`[cron-lock] acquire ${name} threw, running unlocked`, e instanceof Error ? e.message : String(e));
  }

  try {
    return { ran: true, locked, value: await job() };
  } finally {
    if (locked && db) {
      try {
        const { error } = await db.rpc('cron_lock_release', { p_name: name, p_holder: holder });
        // Not fatal: the lease expires on its own.
        if (error) console.error(`[cron-lock] release ${name} failed`, error.code ?? '', error.message ?? '');
      } catch (e) {
        console.error(`[cron-lock] release ${name} threw`, e instanceof Error ? e.message : String(e));
      }
    }
  }
}
