import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectStatus, foldCronRuns, type StatusDb } from '@/lib/status/collect';

type Call = { table: string; cols: string; head: boolean; ops: unknown[][] };
type Answer = { data?: unknown; count?: number | null; error: { message: string; code?: string } | null };

function fakeDb(answer: (c: Call) => Answer) {
  const calls: Call[] = [];
  const db: StatusDb = {
    from(table) {
      return {
        select(cols, opts) {
          const c: Call = { table, cols, head: !!opts?.head, ops: [] };
          calls.push(c);
          const q: Record<string, unknown> = {};
          for (const m of ['eq', 'neq', 'in', 'gte', 'lt', 'lte', 'not', 'order', 'limit']) q[m] = (...a: unknown[]) => { c.ops.push([m, ...a]); return q; };
          q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answer(c)).then(res, rej);
          return q as never;
        },
      };
    },
  };
  return { db, calls };
}

const NOW = Date.UTC(2026, 11, 6, 7, 0);
const iso = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const has = (c: Call, op: string, ...args: unknown[]) => c.ops.some((o) => o[0] === op && args.every((a, i) => JSON.stringify(o[i + 1]) === JSON.stringify(a)));

describe('foldCronRuns', () => {
  it('one line per cron: newest run, its ok, failures in 24 h', () => {
    const rows = [
      { name: 'tick', started_at: iso(0.1), ok: true },
      { name: 'sync', started_at: iso(0.2), ok: false },
      { name: 'tick', started_at: iso(1), ok: false },
      { name: 'tick', started_at: iso(2), ok: false },
      { name: 'sync', started_at: iso(30), ok: false }, // outside the window
    ];
    expect(foldCronRuns(rows, NOW)).toEqual([
      { name: 'sync', lastRunAt: iso(0.2), lastOk: false, failuresLast24h: 1 },
      { name: 'tick', lastRunAt: iso(0.1), lastOk: true, failuresLast24h: 2 },
    ]);
  });
});

describe('collectStatus', () => {
  it('counts only (head:true) for every number; newest timestamps by one-row reads', async () => {
    const { db, calls } = fakeDb((c) => {
      if (!c.head) {
        if (c.table === 'cron_runs') return { data: [{ name: 'tick', started_at: iso(0.1), ok: true }], error: null };
        const col = c.cols;
        return { data: [{ [col]: iso(0.5) }], error: null };
      }
      return { count: 4, error: null };
    });
    const r = await collectStatus(db, NOW);
    expect(r.providers.garmin).toEqual({ lastSyncAt: iso(0.5), connected: 4, staleOver24h: 4, credentialRefused: 4 });
    expect(r.crons).toEqual({ source: 'cron_runs', lastTickAt: iso(0.5), runs: [{ name: 'tick', lastRunAt: iso(0.1), lastOk: true, failuresLast24h: 0 }] });
    expect(r.errors24h).toEqual({ clientErrors: 4, apiErrors: 4, pushRefused: 4, emailFailed: 4 });
    expect(r.queues).toEqual({ notificationsOverdue: 4, planPushPending: 4, planPushBackoff: 4, planPushFailed: 4 });
    // Every non-head read is bounded to one row, except the cron_runs window.
    for (const c of calls.filter((x) => !x.head && x.table !== 'cron_runs')) expect(has(c, 'limit', 1)).toBe(true);
  });

  it('asks the right questions', async () => {
    const { db, calls } = fakeDb(() => ({ count: 0, data: [], error: null }));
    await collectStatus(db, NOW);
    const stale = calls.find((c) => c.table === 'athletes' && c.ops.some((o) => o[0] === 'lt' && o[1] === 'strava_last_sync_at'))!;
    expect(has(stale, 'lt', 'strava_last_sync_at', iso(24))).toBe(true);
    expect(has(stale, 'eq', 'status', 'active')).toBe(true);
    const overdue = calls.find((c) => c.table === 'scheduled_notifications')!;
    expect(has(overdue, 'eq', 'status', 'scheduled')).toBe(true);
    expect(has(overdue, 'lte', 'next_run_at', new Date(NOW - 5 * 60_000).toISOString())).toBe(true);
    const email = calls.find((c) => c.table === 'email_log')!;
    expect(has(email, 'in', 'status', ['refused', 'failed', 'bounced', 'complained'])).toBe(true);
    expect(has(email, 'gte', 'created_at', iso(24))).toBe(true);
  });

  it('a missing table or column is null for that number, not a failure; no cron_runs → tick heartbeat', async () => {
    const { db } = fakeDb((c) => {
      if (c.table === 'cron_runs') return { error: { message: 'relation "cron_runs" does not exist', code: '42P01' } };
      if (c.ops.some((o) => o[0] === 'not' && String(o[1]).endsWith('_auth_failed_at'))) return { error: { message: 'column does not exist', code: '42703' } };
      if (c.table === 'plan_push_status') return { error: { message: 'boom' } };
      if (!c.head) return { data: [], error: null };
      return { count: 2, error: null };
    });
    const r = await collectStatus(db, NOW);
    expect(r.crons).toEqual({ source: 'tick_heartbeat', lastTickAt: null, runs: [] });
    expect(r.providers.garmin.credentialRefused).toBeNull();
    expect(r.providers.garmin.connected).toBe(2);
    expect(r.queues.planPushPending).toBeNull();
    expect(r.queues.notificationsOverdue).toBe(2);
  });

  it('never leaks error text, ids or names', async () => {
    const { db } = fakeDb((c) => {
      if (c.head) return { error: { message: 'secret table detail' } };
      if (c.table === 'cron_runs') return { error: { message: 'secret table detail' } };
      // A newest-timestamp read only ever lets its one column through.
      return { data: [{ id: 'x', name: 'Dana', [c.cols]: iso(1) }], error: null };
    });
    const s = JSON.stringify(await collectStatus(db, NOW));
    expect(s).not.toMatch(/secret|Dana|"id"/);
  });
});

describe('GET /api/admin/status', () => {
  beforeEach(() => vi.resetModules());
  async function load(denied: Response | null) {
    const { db } = fakeDb(() => ({ count: 1, data: [], error: null }));
    vi.doMock('@/lib/supabase/server', () => ({ createServerClient: () => db }));
    vi.doMock('@/lib/auth/self-or-staff', () => ({ requireStaff: async () => denied }));
    return (await import('@/app/api/admin/status/route')).GET;
  }
  it('non-staff → the gate’s answer', async () => {
    const GET = await load(new Response(JSON.stringify({ error: 'Staff access required' }), { status: 403 }));
    expect((await GET(new Request('http://x/api/admin/status'))).status).toBe(403);
  });
  it('staff → 200, private no-store', async () => {
    const GET = await load(null);
    const res = await GET(new Request('http://x/api/admin/status'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(Object.keys(await res.json()).sort()).toEqual(['checkedAt', 'crons', 'errors24h', 'providers', 'queues']);
  });
});
