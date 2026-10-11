// After a test counts: reprice that trainee's loads now, not at their next open. Server-only.
//
// A stored load is stale when the test valid on its day is not the one it was priced on
// (`isStale` in load-server.ts, `basis_test_date`), so approving a first test makes every run
// since that test day stale at once — and before it, every one of them was an HR estimate or
// nothing. `ensureActivityLoads` already knows how to reprice them; this runs it in rounds for
// ONE trainee until nothing is left or the budget is spent, after the response has gone
// (`after()`), so the coach's save is not held for a 400-day history. Whatever the budget
// leaves is priced by the next read or by the nightly sweep (cron/academy-report), as always.
//
// Without migration 142 there is nothing stored to go stale: every read prices in memory from
// the tests, so the new test is in the very next number and this is a no-op.

import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';
import { ensureActivityLoads, hasActivityLoadsTable } from './load-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/** How long one trainee's reprice may run after the response (the route's own ceiling is 60 s). */
export const REPRICE_BUDGET_MS = 25_000;

export interface RepriceResult {
  skipped?: 'no_table';
  priced: number;
  pending: number;
  timedOut: boolean;
}

export async function repriceAthlete(
  db: Db,
  athleteId: string,
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<RepriceResult> {
  const now = opts.now ?? Date.now;
  const budget = opts.budgetMs ?? REPRICE_BUDGET_MS;
  if (!(await hasActivityLoadsTable(db))) return { skipped: 'no_table', priced: 0, pending: 0, timedOut: false };
  const start = now();
  let r = await ensureActivityLoads(db, athleteId, { write: true });
  let priced = r.wrote;
  while (r.pending > 0 && r.wrote > 0 && now() - start < budget) {
    r = await ensureActivityLoads(db, athleteId, { write: true });
    priced += r.wrote;
  }
  return { priced, pending: r.pending, timedOut: r.pending > 0 && now() - start >= budget };
}

/**
 * Trainees with a reprice running in this instance, and whether another was asked for meanwhile.
 * Two saves in a row (a coach's test, then an approval) must not run two overlapping write loops
 * for one trainee — the one that read fewer tests could write last. The second request only marks
 * the running job to go round once more, so the last write always saw the last test.
 */
const inFlight = new Map<string, { again: boolean }>();

/**
 * Reprice after the response. Never throws and never delays the caller: outside a request
 * (a script, a test) `after` is unavailable and the job simply runs detached. One job per
 * trainee at a time (`inFlight`).
 */
export function scheduleReprice(athleteId: string, run: (db: Db, id: string) => Promise<unknown> = repriceAthlete): void {
  const job = async () => {
    const running = inFlight.get(athleteId);
    if (running) { running.again = true; return; }
    const me = { again: false };
    inFlight.set(athleteId, me);
    try {
      do {
        me.again = false;
        try {
          await run(createServerClient(), athleteId);
        } catch (err) {
          console.error('reprice after test failed for', athleteId, err);
        }
      } while (me.again);
    } finally {
      inFlight.delete(athleteId);
    }
  };
  try {
    after(job);
  } catch {
    void job();
  }
}
