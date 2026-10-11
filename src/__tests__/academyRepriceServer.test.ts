import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * lib/academy/reprice-server.ts — after a test counts, that trainee's stale loads are repriced
 * in rounds until none is left or the budget is spent; without migration 142 there is nothing
 * stored to go stale. `ensureActivityLoads` (and its stale rule) is tested in readinessServer
 * and academyLoadServer; this pins the loop around it and that a failure never escapes.
 */

const ensure = vi.fn();
const hasTable = vi.fn();
vi.mock('@/lib/academy/load-server', () => ({
  ensureActivityLoads: (...a: unknown[]) => ensure(...a),
  hasActivityLoadsTable: (...a: unknown[]) => hasTable(...a),
}));
const afterFn = vi.fn();
vi.mock('next/server', () => ({ after: (job: () => unknown) => afterFn(job) }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));

const { repriceAthlete, scheduleReprice } = await import('@/lib/academy/reprice-server');

beforeEach(() => { ensure.mockReset(); hasTable.mockReset(); afterFn.mockReset(); });

describe('repriceAthlete', () => {
  it('prices round after round until nothing is pending', async () => {
    hasTable.mockResolvedValue(true);
    ensure
      .mockResolvedValueOnce({ wrote: 300, pending: 120, rows: [], stored: true })
      .mockResolvedValueOnce({ wrote: 120, pending: 0, rows: [], stored: true });
    const r = await repriceAthlete({} as any, 'a1');
    expect(r).toEqual({ priced: 420, pending: 0, timedOut: false });
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(ensure.mock.calls[0][2]).toEqual({ write: true });
  });

  it('stops at the budget and says so; the rest waits for the next read or the sweep', async () => {
    hasTable.mockResolvedValue(true);
    ensure.mockResolvedValue({ wrote: 300, pending: 500, rows: [], stored: true });
    let t = 0;
    const r = await repriceAthlete({} as any, 'a1', { budgetMs: 1000, now: () => (t += 600) });
    expect(r.timedOut).toBe(true);
    expect(r.pending).toBe(500);
    expect(ensure.mock.calls.length).toBeLessThan(4);
  });

  it('a round that wrote nothing ends the loop (a failed upsert must not spin)', async () => {
    hasTable.mockResolvedValue(true);
    ensure.mockResolvedValue({ wrote: 0, pending: 40, rows: [], stored: true });
    await repriceAthlete({} as any, 'a1');
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('without migration 142 there is nothing to reprice', async () => {
    hasTable.mockResolvedValue(false);
    expect(await repriceAthlete({} as any, 'a1')).toEqual({ skipped: 'no_table', priced: 0, pending: 0, timedOut: false });
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe('scheduleReprice', () => {
  it('runs after the response, and a failure is logged, never thrown', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    scheduleReprice('a1', run);
    expect(afterFn).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    await afterFn.mock.calls[0][0]();
    expect(run).toHaveBeenCalledWith({}, 'a1');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('outside a request (no after()), it runs detached', async () => {
    afterFn.mockImplementation(() => { throw new Error('outside a request scope'); });
    const run = vi.fn().mockResolvedValue(undefined);
    scheduleReprice('a2', run);
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith({}, 'a2');
  });
});
