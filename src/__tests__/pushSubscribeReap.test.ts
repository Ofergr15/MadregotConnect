import { describe, expect, it, vi, beforeEach } from 'vitest';

// /api/push/subscribe now DELETES rows, so the exact filter set matters more
// than the happy path: too broad and it unsubscribes a device that was working
// fine. The cleanup exists because subscribeToPush mints a brand-new endpoint
// on every press while the server kept every previous one forever (one iPhone
// had accumulated four), and Apple answers 201 for those ghosts — so they
// inflate delivery counts instead of 410-ing themselves out.
//
// It is driven by the client naming the endpoint it discarded, never inferred.
// Two inferences were tried and rejected: athlete + user_agent alone deletes a
// genuine second device with an identical UA string, and gating that on a stale
// last_success_at is inert exactly because Apple's 201 keeps a ghost's
// timestamp fresh forever. Verified live: all four of one athlete's endpoints —
// three of them ghosts — returned 201 to 52 consecutive sends.

type Filter = { fn: string; args: unknown[] };
let ops: Array<{ table: string; op: string; filters: Filter[] }>;
let upsertError: { message: string } | null;

// The route gates athleteId on the verified session now — forging it used to
// register YOUR device against someone else's id, from which point their
// notifications arrived on your phone. Resolving a real session needs a real
// Supabase JWT, so the decision is stubbed here (it has its own unit tests in
// selfOrStaff.test.ts) and what this file pins is that the gate is consulted at
// all, and consulted BEFORE anything touches the table.
let gateDenied: Response | null;
let gatedFor: Array<string | null | undefined>;
vi.mock('@/lib/auth/self-or-staff', () => ({
  requireCallerForAthlete: async (_req: Request, target: string | null | undefined) => {
    gatedFor.push(target);
    return { denied: gateDenied, caller: { email: 'a1@test', isSuperUser: false, isStaff: false, athleteId: 'a1' } };
  },
}));

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
  replacesEndpoint: 'https://web.push.apple.com/old',
  ...over,
});

const post = (payload: unknown) =>
  POST(new Request('https://example.test/api/push/subscribe', { method: 'POST', body: JSON.stringify(payload) }));

const reap = () => ops.find((o) => o.op === 'delete');

beforeEach(() => { ops = []; upsertError = null; gateDenied = null; gatedFor = []; });

describe('POST /api/push/subscribe — retiring a superseded endpoint', () => {
  it('deletes exactly the named endpoint, scoped to this athlete', async () => {
    const res = await post(body());
    expect(res.status).toBe(200);

    const del = reap();
    expect(del?.table).toBe('push_subscriptions');
    expect(del?.filters).toEqual([
      // Scoped by athlete so a stray endpoint string can't delete anyone else's row.
      { fn: 'eq', args: ['athlete_id', 'a1'] },
      { fn: 'eq', args: ['endpoint', 'https://web.push.apple.com/old'] },
    ]);
  });

  it('deletes nothing when the client names no predecessor', async () => {
    // ensurePushSubscription's refresh path: the endpoint it found is the one
    // it re-posts, so there is nothing to retire. Deleting on a guess here
    // would unsubscribe a healthy device.
    await post(body({ replacesEndpoint: undefined }));
    expect(reap()).toBeUndefined();
  });

  it('never deletes the endpoint it was just asked to store', async () => {
    // A client that reports the same endpoint as both current and superseded
    // (a no-op resubscribe) must not delete the row it just upserted.
    await post(body({ replacesEndpoint: 'https://web.push.apple.com/new' }));
    expect(reap()).toBeUndefined();
  });

  it('does not touch other devices belonging to the same athlete', async () => {
    // The rejected heuristic: matching on athlete + user_agent would have
    // deleted a genuine second same-model iPhone's subscription.
    await post(body());
    const filters = reap()?.filters.map((f) => f.args[0]);
    expect(filters).not.toContain('user_agent');
  });

  it('upserts on endpoint, so re-subscribing the same device updates rather than duplicates', async () => {
    await post(body());
    const up = ops.find((o) => o.op === 'upsert');
    expect(up?.filters[0].args[1]).toEqual({ onConflict: 'endpoint' });
  });

  it('does not delete when the upsert itself failed — never trade a stored subscription for a lost one', async () => {
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

describe('POST /api/push/subscribe — who may register a device', () => {
  it('checks the caller against the athleteId in the body', async () => {
    await post(body());
    expect(gatedFor).toEqual(['a1']);
  });

  it('stores nothing at all when the gate denies', async () => {
    // The whole point: a forged athleteId must not reach the upsert, or the
    // device is registered against someone else's notifications regardless of
    // what status code comes back.
    gateDenied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
    const res = await post(body());
    expect(res.status).toBe(403);
    expect(ops).toHaveLength(0);
  });

  it('returns the auth layer\'s own response rather than inventing one', async () => {
    // A missing token has to read as 401, not 403 or 500 — the client
    // (saveSubscription) surfaces `save_failed_401` on the device, which is how
    // a credential problem becomes visible instead of silently going quiet.
    gateDenied = new Response(JSON.stringify({ error: 'Missing bearer token' }), { status: 401 });
    expect((await post(body())).status).toBe(401);
  });

  it('validates the payload before the gate — a 400 stays a 400', async () => {
    // Cheap local checks first, so a malformed body doesn't cost a session
    // lookup and doesn't come back as a confusing 401.
    gateDenied = new Response(null, { status: 401 });
    expect((await post({ subscription: null })).status).toBe(400);
    expect(gatedFor).toHaveLength(0);
  });
});
