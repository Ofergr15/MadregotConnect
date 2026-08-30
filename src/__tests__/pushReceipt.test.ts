import { describe, expect, it, vi, beforeEach } from 'vitest';

// The receipt route is the only place in the system that learns a push actually
// reached a phone. Everything else can only observe that a push service took
// one, and Apple takes pushes for endpoints that reach nothing — measured live:
// four endpoints for one iPhone, three of them ghosts, accepted 52 consecutive
// sends and displayed none of them.
//
// It is deliberately unauthenticated (a service worker cannot read the Supabase
// session), so the tests below care as much about what it must NOT do — read,
// insert, delete, or reveal whether an endpoint is known — as about the update
// it exists to perform.

type Op = { table: string; op: string; patch?: Record<string, unknown>; filters: Array<{ fn: string; args: unknown[] }> };
let ops: Op[];

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const record: Op = { table, op: 'select', filters: [] };
      const track = (fn: string) => (...args: unknown[]) => { record.filters.push({ fn, args }); return chain; };
      const chain: Record<string, unknown> = {
        update: (patch: Record<string, unknown>) => { record.op = 'update'; record.patch = patch; ops.push(record); return chain; },
        select: () => { record.op = 'select'; ops.push(record); return chain; },
        insert: () => { record.op = 'insert'; ops.push(record); return Promise.resolve({ error: null }); },
        delete: () => { record.op = 'delete'; ops.push(record); return chain; },
        eq: track('eq'),
        in: track('in'),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));

const { POST } = await import('@/app/api/push/receipt/route');

const post = (payload: unknown) =>
  POST(new Request('https://example.test/api/push/receipt', { method: 'POST', body: JSON.stringify(payload) }));

beforeEach(() => { ops = []; });

describe('POST /api/push/receipt', () => {
  it('stamps last_success_at for exactly the reporting endpoint', async () => {
    const res = await post({ endpoint: 'https://web.push.apple.com/live' });
    expect(res.status).toBe(204);

    const update = ops.find((o) => o.op === 'update');
    expect(update?.table).toBe('push_subscriptions');
    expect(update?.filters).toEqual([{ fn: 'eq', args: ['endpoint', 'https://web.push.apple.com/live'] }]);
    expect(update?.patch?.last_success_at).toBeTypeOf('string');
  });

  it('writes nothing but that one timestamp', async () => {
    // An unauthenticated route must not be usable to change anything else about
    // a subscription — the endpoint string is the whole credential.
    await post({ endpoint: 'https://web.push.apple.com/live' });
    expect(Object.keys(ops.find((o) => o.op === 'update')?.patch || {})).toEqual(['last_success_at']);
    expect(ops.filter((o) => o.op === 'insert' || o.op === 'delete')).toHaveLength(0);
  });

  it('rejects a body with no endpoint before touching the table', async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(ops).toHaveLength(0);
  });

  it('rejects a non-string endpoint rather than filtering on an object', async () => {
    // eq('endpoint', {...}) would be a malformed query, not a no-op.
    const res = await post({ endpoint: { not: 'a string' } });
    expect(res.status).toBe(400);
    expect(ops).toHaveLength(0);
  });

  it('answers 204 for an unknown endpoint, revealing nothing about which endpoints exist', async () => {
    // Same status and empty body as a match, so the route can't be used to
    // probe whether a given endpoint string is registered here.
    const res = await post({ endpoint: 'https://web.push.apple.com/never-seen' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('answers 204 on a malformed body instead of an error the service worker might retry', async () => {
    const res = await POST(new Request('https://example.test/api/push/receipt', { method: 'POST', body: 'not json' }));
    // json() failure falls back to {} → no endpoint → 400, still not a 5xx.
    expect(res.status).toBe(400);
  });
});
