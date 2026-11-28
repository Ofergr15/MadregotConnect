// Task 95: Strava webhook processing is idempotent, keyed by the Strava activity id.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createSeenSet, eventKey, webhookDecision } from '@/lib/strava/webhook-dedupe';

const h = vi.hoisted(() => ({ kept: [] as Array<() => Promise<unknown>>, synced: 0, stored: new Set<number>() }));
vi.mock('next/server', async (orig) => ({ ...(await orig<object>()), after: (fn: () => Promise<unknown>) => { h.kept.push(fn); } }));
vi.mock('@/app/api/strava/sync-activities/route', () => ({ runStravaSyncRequest: async () => { h.synced++; return new Response('{}'); } }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const f: Record<string, unknown> = {};
      const q: any = { select: () => q, eq: (k: string, v: unknown) => { f[k] = v; return q; }, limit: () => q,
        maybeSingle: async () => (table === 'athletes' ? { data: { id: 'a1' } } : { data: h.stored.has(f.strava_activity_id as number) ? { id: 'x' } : null }) };
      return q;
    },
  }),
}));
const { POST } = await import('@/app/api/strava/webhook/route');
const post = (b: object) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ object_type: 'activity', owner_id: 42, ...b }) }));
const drain = async () => { while (h.kept.length) await h.kept.shift()!(); };
beforeEach(async () => { await drain(); h.synced = 0; h.stored.clear(); });

describe('pure', () => {
  it('event key = activity id + aspect + event time', () => {
    expect(eventKey({ object_id: 9, aspect_type: 'create', event_time: 100 })).toBe('9:create:100');
    expect(eventKey({})).toBeNull();
  });
  it('seen set: repeat inside the TTL is not first; after it, it is', () => {
    const s = createSeenSet(1000);
    expect([s.firstTime('k', 0), s.firstTime('k', 500), s.firstTime('k', 2000)]).toEqual([true, false, true]);
  });
  it('decisions', () => {
    const f = { firstTime: true, alreadyStored: false, inflight: false };
    expect(webhookDecision({ object_type: 'athlete', owner_id: 1 }, f)).toBe('ignore');
    expect(webhookDecision({ object_type: 'activity', aspect_type: 'delete', owner_id: 1 }, f)).toBe('ignore');
    expect(webhookDecision({ object_type: 'activity', aspect_type: 'create', owner_id: 1 }, { ...f, firstTime: false })).toBe('skip_retry');
    expect(webhookDecision({ object_type: 'activity', aspect_type: 'create', owner_id: 1 }, { ...f, alreadyStored: true })).toBe('skip_stored');
    expect(webhookDecision({ object_type: 'activity', aspect_type: 'update', owner_id: 1 }, { ...f, alreadyStored: true })).toBe('sync');
    expect(webhookDecision({ object_type: 'activity', aspect_type: 'create', owner_id: 1 }, { ...f, inflight: true })).toBe('skip_inflight');
  });
});

describe('POST /api/strava/webhook', () => {
  it('a Strava retry of the same event syncs once', async () => {
    await post({ aspect_type: 'create', object_id: 1001, event_time: 1 });
    await drain();
    const again = await post({ aspect_type: 'create', object_id: 1001, event_time: 1 });
    expect(await again.json()).toEqual({ skipped: 'skip_retry' });
    await drain();
    expect(h.synced).toBe(1);
  });
  it('create for an activity already stored is skipped (always 200)', async () => {
    h.stored.add(2002);
    const res = await post({ aspect_type: 'create', object_id: 2002, event_time: 2 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: 'skip_stored' });
    expect(h.kept).toHaveLength(0);
  });
  it('create + update while the sync is still running → one sync', async () => {
    await post({ aspect_type: 'create', object_id: 3003, event_time: 3 });
    const upd = await post({ aspect_type: 'update', object_id: 3003, event_time: 4 });
    expect(await upd.json()).toEqual({ skipped: 'skip_inflight' });
    await drain();
    expect(h.synced).toBe(1);
  });
  it('a later update (after the sync finished) syncs again', async () => {
    await post({ aspect_type: 'create', object_id: 4004, event_time: 5 });
    await drain();
    await post({ aspect_type: 'update', object_id: 4004, event_time: 6 });
    await drain();
    expect(h.synced).toBe(2);
  });
});
