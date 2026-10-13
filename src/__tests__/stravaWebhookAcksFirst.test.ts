import { describe, expect, it, vi } from 'vitest';

/** The Strava webhook answers 200 before the sync runs — Strava wants it within 2 s. */

const h = vi.hoisted(() => ({ kept: [] as Array<() => Promise<unknown>>, synced: 0 }));
vi.mock('next/server', async (orig) => ({ ...(await orig<object>()), after: (fn: () => Promise<unknown>) => { h.kept.push(fn); } }));
vi.mock('@/app/api/strava/sync-activities/route', () => ({ runStravaSyncRequest: async () => { h.synced++; return new Response('{}'); } }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'a1' } }) }) }) }) }),
}));

import { POST } from '@/app/api/strava/webhook/route';

describe('Strava webhook', () => {
  it('acks a new activity before syncing, then syncs it', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ object_type: 'activity', aspect_type: 'create', owner_id: 42 }) }));
    expect(res.status).toBe(200);
    expect(h.synced).toBe(0);          // not yet: the 200 went first
    expect(h.kept).toHaveLength(1);
    await h.kept[0]();
    expect(h.synced).toBe(1);
  });
});
