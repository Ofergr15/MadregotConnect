import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => { throw new Error('no db in tests'); } }));

import { withCronLock, type LockDb } from '@/lib/cron/lock';

/**
 * An in-memory stand-in for migration 355's two functions: one lease per name,
 * expiry honoured, release only by the holder. Enough to prove the wrapper's
 * contract — the SQL itself is pasted by hand and not run here.
 */
function fakeDb(now = () => Date.now()) {
  const leases = new Map<string, { holder: string; expires: number }>();
  const calls: string[] = [];
  const db: LockDb = {
    rpc: async (fn, args) => {
      calls.push(fn);
      const name = String(args.p_name);
      if (fn === 'cron_lock_acquire') {
        const cur = leases.get(name);
        if (cur && cur.expires > now()) return { data: false, error: null };
        leases.set(name, { holder: String(args.p_holder), expires: now() + Number(args.p_ttl_seconds) * 1000 });
        return { data: true, error: null };
      }
      const cur = leases.get(name);
      if (cur?.holder === args.p_holder) { leases.delete(name); return { data: true, error: null }; }
      return { data: false, error: null };
    },
  };
  return { db, leases, calls };
}

describe('withCronLock', () => {
  it('runs the job and releases the lease', async () => {
    const { db, leases } = fakeDb();
    const out = await withCronLock('sync', 330, async () => 7, { db });
    expect(out).toEqual({ ran: true, locked: true, value: 7 });
    expect(leases.size).toBe(0);
  });

  it('a second run while the first is going is skipped, not queued', async () => {
    const { db } = fakeDb();
    let release!: () => void;
    const first = withCronLock('sync', 330, () => new Promise<string>((r) => { release = () => r('first'); }), { db });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const job = vi.fn(async () => 'second');
    const second = await withCronLock('sync', 330, job, { db });
    expect(second).toEqual({ ran: false, reason: 'held' });
    expect(job).not.toHaveBeenCalled();
    release();
    expect(await first).toMatchObject({ ran: true, value: 'first' });
    // Free again once the first is done.
    expect(await withCronLock('sync', 330, async () => 'third', { db })).toMatchObject({ ran: true, value: 'third' });
  });

  it('different names do not block each other', async () => {
    const { db } = fakeDb();
    let release!: () => void;
    const a = withCronLock('sync', 330, () => new Promise<void>((r) => { release = r; }), { db });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(await withCronLock('wellness', 330, async () => 1, { db })).toMatchObject({ ran: true });
    release();
    await a;
  });

  it('releases even when the job throws', async () => {
    const { db, leases } = fakeDb();
    await expect(withCronLock('sync', 330, async () => { throw new Error('boom'); }, { db })).rejects.toThrow('boom');
    expect(leases.size).toBe(0);
  });

  it('an expired lease (a killed run) no longer blocks', async () => {
    let t = 0;
    const { db, leases } = fakeDb(() => t);
    leases.set('sync', { holder: 'dead-run', expires: 330_000 });
    t = 200_000;
    expect(await withCronLock('sync', 330, async () => 1, { db })).toEqual({ ran: false, reason: 'held' });
    t = 331_000;
    expect(await withCronLock('sync', 330, async () => 2, { db })).toMatchObject({ ran: true, value: 2 });
  });

  it('a run that outlived its lease cannot free the newer run\'s lease', async () => {
    let t = 0;
    const { db, leases } = fakeDb(() => t);
    let releaseOld!: () => void;
    const old = withCronLock('sync', 10, () => new Promise<void>((r) => { releaseOld = r; }), { db, holder: 'old' });
    await vi.waitFor(() => expect(releaseOld).toBeTypeOf('function'));
    t = 11_000;
    let releaseNew!: () => void;
    const fresh = withCronLock('sync', 10, () => new Promise<void>((r) => { releaseNew = r; }), { db, holder: 'new' });
    await vi.waitFor(() => expect(releaseNew).toBeTypeOf('function'));
    releaseOld();
    await old;
    expect(leases.get('sync')?.holder).toBe('new');
    releaseNew();
    await fresh;
  });

  it('fails open when the rpc errors (migration 355 not applied)', async () => {
    const calls: string[] = [];
    const db: LockDb = { rpc: async (fn) => { calls.push(fn); return { data: null, error: { code: '42883', message: 'function does not exist' } }; } };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await withCronLock('sync', 330, async () => 'ran', { db });
    expect(out).toEqual({ ran: true, locked: false, value: 'ran' });
    expect(calls).toEqual(['cron_lock_acquire']); // nothing to release
    err.mockRestore();
  });

  it('fails open when the client cannot even be built', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await withCronLock('sync', 330, async () => 'ran')).toEqual({ ran: true, locked: false, value: 'ran' });
    err.mockRestore();
  });

  it('a failed release does not fail the run', async () => {
    const db: LockDb = {
      rpc: async (fn) => (fn === 'cron_lock_acquire' ? { data: true, error: null } : { data: null, error: { message: 'down' } }),
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await withCronLock('sync', 330, async () => 'ok', { db })).toEqual({ ran: true, locked: true, value: 'ok' });
    err.mockRestore();
  });
});

describe('cron/sync is wrapped', () => {
  const src = readFileSync(new URL('../app/api/cron/sync/route.ts', import.meta.url), 'utf8');
  it('takes the sync lock around its passes, with a TTL longer than maxDuration', async () => {
    expect(src).toMatch(/withCronLock\('sync', SYNC_LOCK_TTL_SECONDS, syncPasses\)/);
    const { SYNC_LOCK_TTL_SECONDS, maxDuration } = await import('@/app/api/cron/sync/route');
    expect(SYNC_LOCK_TTL_SECONDS).toBeGreaterThan(maxDuration);
    expect(SYNC_LOCK_TTL_SECONDS).toBeLessThan(maxDuration * 2 + 60);
  });
});

describe('migration 355', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/355_cron_locks.sql', import.meta.url), 'utf8');
  it('is idempotent and service-role only', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.cron_locks/);
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.cron_lock_acquire[^;]*FROM PUBLIC, anon, authenticated/);
  });
});
