import { describe, expect, it, vi, beforeEach } from 'vitest';

// /api/push/subscribe now DELETES rows, so the exact filter set matters more
// than the happy path: too broad and it unsubscribes a device that was working
// fine. The reap exists because subscribeToPush mints a brand-new endpoint on
// every press while the server kept every previous one forever (one iPhone had
// accumulated four), and Apple answers 201 for those orphans — so they inflate
// delivery counts instead of 410-ing themselves out.

type Filter = { fn: string; args: unknown[] };
let ops: Array<{ table: string; op: string; filters: Filter[] }>;
let upsertError: { message: string } | null;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const record: { table: string; op: string; filters: Filter[] } = { table, op: 'select', filters: [] };
      const track = (fn: string) => (...args: unknown[]) => { record.filters.push({ fn, args }); return chain; };
      const chain: Record<string, unknown> = {
        upsert: (...args: unknown[]) => {
          record.op = 'upsert';
          record.filters.push({ fn: 'upsert', args });
          ops.push(record);
          return Promise.resolve({ error: upsertError });
        },
        delete: () => { record.op = 'delete'; ops.push(record); return chain; },
        eq: track('eq'),
        neq: track('neq'),
        lt: track('lt'),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));

const { POST } = await import('@/app/api/push/subscribe/route');

const body = (over: Record<string, unknown> = {}) => ({
  athleteId: 'a1',
  subscription: { endpoint: 'https://web.push.apple.com/new', keys: { p256dh: 'p', auth: 'a' } },
  userAgent: 'Mozilla/5.0 (iPhone)',
  ...over,
});

const post = (payload: unknown) =>
  POST(new Request('https://example.test/api/push/subscribe', { method: 'POST', body: JSON.stringify(payload) }));

const reap = () => ops.find((o) => o.op === 'delete');

beforeEach(() => { ops = []; upsertError = null; });

describe('POST /api/push/subscribe — orphan reaping', () => {
  it('scopes the delete to this athlete, this device, and only OTHER endpoints', async () => {
    const res = await post(body());
    expect(res.status).toBe(200);

    const del = reap();
    expect(del?.table).toBe('push_subscriptions');
    expect(del?.filters).toEqual([
      { fn: 'eq', args: ['athlete_id', 'a1'] },
      { fn: 'eq', args: ['user_agent', 'Mozilla/5.0 (iPhone)'] },
      // Without this the row just upserted would delete itself.
      { fn: 'neq', args: ['endpoint', 'https://web.push.apple.com/new'] },
      { fn: 'lt', args: ['last_success_at', expect.any(String)] },
    ]);
  });

  it('only reaps endpoints with no confirmed delivery in the last 7 days', async () => {
    await post(body());
    const cutoff = reap()?.filters.find((f) => f.fn === 'lt')?.args[1] as string;
    const ageDays = (Date.now() - Date.parse(cutoff)) / 86_400_000;
    expect(ageDays).toBeGreaterThan(6.9);
    expect(ageDays).toBeLessThan(7.1);
  });

  it('reaps nothing when the client sent no user agent — a device it cannot identify', async () => {
    // Matching on athlete_id alone would wipe every OTHER device this athlete owns.
    await post(body({ userAgent: undefined }));
    expect(reap()).toBeUndefined();
  });

  it('upserts on endpoint, so re-subscribing the same device updates rather than duplicates', async () => {
    await post(body());
    const up = ops.find((o) => o.op === 'upsert');
    expect(up?.filters[0].args[1]).toEqual({ onConflict: 'endpoint' });
  });

  it('does not reap when the upsert itself failed — never trade a stored subscription for a lost one', async () => {
    upsertError = { message: 'insert failed' };
    const res = await post(body());
    expect(res.status).toBe(500);
    expect(reap()).toBeUndefined();
  });

  it('rejects a malformed subscription before touching the table', async () => {
    const res = await post({ athleteId: 'a1', subscription: { endpoint: 'x' } }); // no keys
    expect(res.status).toBe(400);
    expect(ops).toHaveLength(0);
  });
});
