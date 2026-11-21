import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/runs/meetups `spots` (the post sheet's place suggestions), through the real
 * handler. Owner-approved scope 2026-11-21: a past run's named place is suggested only to a
 * viewer who may see that run (meetupVisibleTo — host, accepted joiners, the run's audience).
 * Club spots are unchanged. Synthetic ids, names and coordinates only.
 */
const h = vi.hoisted(() => ({
  viewer: 'v' as string | null,
  past: [] as unknown[],
  mine: { data: [] as unknown[], error: null as unknown },
}));
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/self-or-staff')>()), requireMember: vi.fn(async () => null) }));
vi.mock('@/lib/auth-session', () => ({
  requireAthlete: vi.fn(async () => (h.viewer ? { ok: true, user: { athleteId: h.viewer } } : { ok: false })),
  authError: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn() }));
vi.mock('@/lib/runs/meetups-server', async (orig) => ({
  ...(await orig<typeof import('@/lib/runs/meetups-server')>()),
  roster: vi.fn(async () => new Map([
    ['host1', { id: 'host1', name: 'H', avatarUrl: null, pack: 1 }],
    ['p1', { id: 'p1', name: 'A', avatarUrl: null, pack: 1 }],
    ['p2', { id: 'p2', name: 'B', avatarUrl: null, pack: 2 }],
  ])),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const st = { limited: false, byAthlete: false };
      const b: any = {
        select: () => b, gte: () => b, order: () => b, in: () => b,
        eq: (c: string) => { if (c === 'athlete_id') st.byAthlete = true; return b; },
        limit: () => { st.limited = true; return b; },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (ok: any, bad: any) => Promise.resolve(
          table === 'run_meetups' ? { data: st.limited ? h.past : [], error: null }
          : table === 'run_meetup_requests' && st.byAthlete ? h.mine
          : { data: [], error: null }).then(ok, bad),
      };
      return b;
    },
  }),
}));

const PACK_RUN = { id: 'm-pack', host_athlete_id: 'host1', audience: 'pack', location: 'Synthetic Pack Spot', lat: 31.5, lng: 35.1 };
const CLUB_RUN = { id: 'm-club', host_athlete_id: 'host1', audience: 'club', location: 'Synthetic Club Spot', lat: 31.6, lng: 35.2 };

async function spotNames(): Promise<string[]> {
  const { GET } = await import('@/app/api/runs/meetups/route');
  const res = await GET(new Request('http://x/api/runs/meetups'));
  expect(res.status).toBe(200);
  return ((await res.json()).spots as Array<{ name: string }>).map((s) => s.name);
}

beforeEach(() => { h.viewer = 'p2'; h.past = [PACK_RUN, CLUB_RUN]; h.mine = { data: [], error: null }; });

describe('runs/meetups — past-run place suggestions follow run visibility', () => {
  it('outside the pack: pack-only run place withheld; club-audience place kept; curated spots kept', async () => {
    const n = await spotNames();
    expect(n).not.toContain('Synthetic Pack Spot');
    expect(n).toContain('Synthetic Club Spot');
    expect(n.length).toBe(5);
  });
  it('same pack: pack-only run place suggested', async () => {
    h.viewer = 'p1';
    expect(await spotNames()).toContain('Synthetic Pack Spot');
  });
  it('host (any pack): own pack-only run place suggested', async () => {
    h.viewer = 'host1';
    expect(await spotNames()).toContain('Synthetic Pack Spot');
  });
  it('accepted joiner outside the pack: suggested', async () => {
    h.mine = { data: [{ meetup_id: 'm-pack' }], error: null };
    expect(await spotNames()).toContain('Synthetic Pack Spot');
  });
  it('joined-runs read fails: treated as no joins (withheld outside the pack, never wider)', async () => {
    h.mine = { data: null as never, error: { message: 'boom' } };
    const n = await spotNames();
    expect(n).not.toContain('Synthetic Pack Spot');
    expect(n).toContain('Synthetic Club Spot');
  });
  it('member with no athlete row: curated spots only', async () => {
    h.viewer = null;
    expect((await spotNames()).length).toBe(4);
  });
});
