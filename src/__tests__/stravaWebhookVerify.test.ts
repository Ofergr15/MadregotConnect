// Task 192: Strava webhook authenticity (shape, subscription id, replay window,
// constant-time verify token) and idempotency across instances (migration 356).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimStravaEvent, MAX_EVENT_AGE_S, MAX_EVENT_SKEW_S, purgeOldStravaEvents, verifyStravaEvent, verifyTokenMatches, type EventStore,
} from '@/lib/strava/webhook-verify';

const NOW = 1_800_000_000;
const ev = (p: Record<string, unknown> = {}) => ({
  object_type: 'activity', aspect_type: 'create', object_id: 111, owner_id: 42, event_time: NOW - 5, subscription_id: 9001, updates: {}, ...p,
});

describe('verifyStravaEvent', () => {
  it('accepts a real-shape event and returns only the known fields', () => {
    const r = verifyStravaEvent(ev({ extra: 'x' }), { subscriptionId: '9001', nowS: NOW });
    expect(r).toEqual({ ok: true, event: { object_type: 'activity', aspect_type: 'create', object_id: 111, owner_id: 42, event_time: NOW - 5, subscription_id: 9001 } });
  });
  it.each([
    ['not an object', 'x'],
    ['array', [ev()]],
    ['unknown object_type', ev({ object_type: 'route' })],
    ['unknown aspect', ev({ aspect_type: 'merge' })],
    ['string ids', ev({ object_id: '111' })],
    ['negative owner', ev({ owner_id: -1 })],
    ['float time', ev({ event_time: NOW - 0.5 })],
    ['missing time', ev({ event_time: undefined })],
    ['bad subscription type', ev({ subscription_id: 'abc' })],
  ])('refuses %s as shape', (_n, payload) => {
    expect(verifyStravaEvent(payload, { nowS: NOW })).toEqual({ ok: false, reason: 'shape' });
  });
  it('checks the subscription id only when configured', () => {
    expect(verifyStravaEvent(ev({ subscription_id: 1 }), { subscriptionId: '9001', nowS: NOW })).toEqual({ ok: false, reason: 'subscription' });
    expect(verifyStravaEvent(ev({ subscription_id: undefined }), { subscriptionId: '9001', nowS: NOW })).toEqual({ ok: false, reason: 'subscription' });
    expect(verifyStravaEvent(ev({ subscription_id: 1 }), { subscriptionId: '', nowS: NOW }).ok).toBe(true);
    expect(verifyStravaEvent(ev({ subscription_id: 1 }), { nowS: NOW }).ok).toBe(true);
  });
  it('replay window: a day old is refused, slightly ahead is fine, far ahead is refused', () => {
    expect(verifyStravaEvent(ev({ event_time: NOW - MAX_EVENT_AGE_S }), { nowS: NOW }).ok).toBe(true);
    expect(verifyStravaEvent(ev({ event_time: NOW - MAX_EVENT_AGE_S - 1 }), { nowS: NOW })).toEqual({ ok: false, reason: 'stale' });
    expect(verifyStravaEvent(ev({ event_time: NOW + MAX_EVENT_SKEW_S }), { nowS: NOW }).ok).toBe(true);
    expect(verifyStravaEvent(ev({ event_time: NOW + MAX_EVENT_SKEW_S + 1 }), { nowS: NOW })).toEqual({ ok: false, reason: 'future' });
  });
});

describe('verifyTokenMatches', () => {
  it('matches only the exact token; empty never matches', () => {
    expect(verifyTokenMatches('abc', 'abc')).toBe(true);
    expect(verifyTokenMatches('abd', 'abc')).toBe(false);
    expect(verifyTokenMatches('abcd', 'abc')).toBe(false);
    expect(verifyTokenMatches('', '')).toBe(false);
    expect(verifyTokenMatches(null, undefined)).toBe(false);
    expect(verifyTokenMatches('x', undefined)).toBe(false);
  });
});

function memStore(opts: { missing?: boolean; fail?: boolean } = {}) {
  const keys = new Map<string, number>();
  const deletes: string[] = [];
  const db: EventStore = {
    from: () => ({
      insert: async ({ event_key }) => {
        if (opts.missing) return { error: { code: 'PGRST205', message: 'Could not find the table' } };
        if (opts.fail) return { error: { code: '57014', message: 'timeout' } };
        if (keys.has(event_key)) return { error: { code: '23505', message: 'duplicate key' } };
        keys.set(event_key, Date.now());
        return { error: null };
      },
      delete: () => ({ lt: async (_c, v) => { deletes.push(v); return { error: null }; } }),
    }),
  };
  return { db, keys, deletes };
}

describe('claimStravaEvent', () => {
  it('first, then duplicate', async () => {
    const { db } = memStore();
    expect(await claimStravaEvent(db, 'k')).toBe('first');
    expect(await claimStravaEvent(db, 'k')).toBe('duplicate');
    expect(await claimStravaEvent(db, 'k2')).toBe('first');
  });
  it('unknown when 356 is not applied (quietly) or the insert fails (logged)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await claimStravaEvent(memStore({ missing: true }).db, 'k')).toBe('unknown');
    expect(err).not.toHaveBeenCalled();
    expect(await claimStravaEvent(memStore({ fail: true }).db, 'k')).toBe('unknown');
    expect(err).toHaveBeenCalledTimes(1);
    expect(await claimStravaEvent({ from: () => { throw new Error('x'); } } as unknown as EventStore, 'k')).toBe('unknown');
    err.mockRestore();
  });
  it('purge deletes claims older than 7 days', async () => {
    const { db, deletes } = memStore();
    await purgeOldStravaEvents(db, Date.parse('2026-11-28T00:00:00Z'));
    expect(deletes).toEqual(['2026-11-21T00:00:00.000Z']);
  });
});

// ── the route ────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  kept: [] as Array<() => Promise<unknown>>,
  synced: 0,
  claimed: new Set<string>(),
  inserts: 0,
}));
vi.mock('next/server', async (orig) => ({ ...(await orig<object>()), after: (fn: () => Promise<unknown>) => { h.kept.push(fn); } }));
vi.mock('@/app/api/strava/sync-activities/route', () => ({ runStravaSyncRequest: async () => { h.synced++; return new Response('{}'); } }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      if (table === 'strava_webhook_events') {
        return {
          insert: async ({ event_key }: { event_key: string }) => {
            h.inserts++;
            if (h.claimed.has(event_key)) return { error: { code: '23505', message: 'dup' } };
            h.claimed.add(event_key);
            return { error: null };
          },
          delete: () => ({ lt: async () => ({ error: null }) }),
        };
      }
      const q: Record<string, unknown> = {};
      q.select = () => q; q.eq = () => q; q.limit = () => q;
      q.maybeSingle = async () => (table === 'athletes' ? { data: { id: 'a1' } } : { data: null });
      return q;
    },
  }),
}));

const { GET, POST } = await import('@/app/api/strava/webhook/route');
const nowS = () => Math.floor(Date.now() / 1000);
const post = (b: object) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }));
const drain = async () => { while (h.kept.length) await h.kept.shift()!(); };
afterEach(() => { vi.unstubAllEnvs(); });

describe('POST /api/strava/webhook (verified)', () => {
  beforeEach(async () => {
    await drain();
    h.synced = 0; h.claimed.clear(); h.inserts = 0;
    vi.stubEnv('STRAVA_WEBHOOK_SUBSCRIPTION_ID', '9001');
  });

  it('a foreign subscription is 403 and syncs nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post(ev({ subscription_id: 1, event_time: nowS() }));
    expect(res.status).toBe(403);
    await drain();
    expect(h.synced).toBe(0);
    expect(h.inserts).toBe(0);
    warn.mockRestore();
  });

  it('a replayed old event is acked 200 and ignored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post(ev({ event_time: nowS() - 3 * 86_400 }));
    expect(res.status).toBe(200);
    await drain();
    expect(h.synced).toBe(0);
    warn.mockRestore();
  });

  it('the same event delivered to a second (cold) instance syncs once via the DB claim', async () => {
    const t = nowS();
    await post(ev({ object_id: 5005, event_time: t }));
    await drain();
    expect(h.synced).toBe(1);
    // A cold instance has an empty in-memory set: re-import the module fresh.
    vi.resetModules();
    const fresh = await import('@/app/api/strava/webhook/route');
    const res = await fresh.POST(new Request('http://x', { method: 'POST', body: JSON.stringify(ev({ object_id: 5005, event_time: t })) }));
    expect(await res.json()).toEqual({ skipped: 'skip_retry' });
    await drain();
    expect(h.synced).toBe(1);
  });

  it('a new event still syncs', async () => {
    await post(ev({ object_id: 6006, event_time: nowS() }));
    await drain();
    expect(h.synced).toBe(1);
  });
});

describe('GET /api/strava/webhook handshake', () => {
  it('echoes the challenge only for the exact verify token', async () => {
    vi.stubEnv('STRAVA_WEBHOOK_VERIFY_TOKEN', 'secret-token');
    const get = (tok: string) => GET(new Request(`http://x/api/strava/webhook?hub.mode=subscribe&hub.verify_token=${tok}&hub.challenge=c1`));
    const ok = await get('secret-token');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ 'hub.challenge': 'c1' });
    expect((await get('secret-tokeN')).status).toBe(403);
    expect((await get('')).status).toBe(403);
    vi.stubEnv('STRAVA_WEBHOOK_VERIFY_TOKEN', '');
    expect((await get('')).status).toBe(403);
  });
});
