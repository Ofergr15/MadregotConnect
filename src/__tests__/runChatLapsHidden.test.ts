import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/run-chat/laps honours the runner's hidden stats (feed_items.payload.hiddenFields)
 * for callers who are not the runner and not staff. Synthetic ids and rows only.
 */
const ACT = '00000000-0000-4000-8000-0000000000b2';
const OWNER = 'owner-athlete';

const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  feed: { data: [] as unknown[], error: null as unknown } as { data: unknown[] | null; error: unknown },
  feedThrows: false,
}));

vi.mock('@/lib/auth-session', () => ({
  requireSession: vi.fn(async () => ({ ok: true, user: h.user })),
  authError: vi.fn(),
}));
vi.mock('@/lib/run-chat/access', () => ({ canAccessChat: () => true }));
vi.mock('@/lib/strava/enrich', () => ({ enrichActivityRowFromStrava: vi.fn(async () => false) }));

const ROW = {
  id: ACT, athlete_id: OWNER, strava_activity_id: 1, activity_name: 'Tempo', start_time: '2026-11-19T06:00:00+00:00',
  laps: [
    { lap_index: 1, name: 'Lap 1', distance: 1000, moving_time: 240, elapsed_time: 245, average_speed: 4.17, max_speed: 4.6, average_heartrate: 160, max_heartrate: 171 },
    { lap_index: 2, name: 'Lap 2', distance: 1000, moving_time: 236, elapsed_time: 236, average_speed: 4.24, average_heartrate: 165, max_heartrate: 175 },
  ],
};
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      if (table === 'feed_items' && h.feedThrows) throw new Error('boom');
      const b: any = {
        select: () => b, eq: () => b, limit: () => b,
        maybeSingle: async () => ({ data: table === 'athlete_activities' ? ROW : null, error: null }),
        then: (ok: any, bad: any) => Promise.resolve(table === 'feed_items' ? h.feed : { data: [], error: null }).then(ok, bad),
      };
      return b;
    },
  }),
}));

const as = (athleteId: string, isStaff = false) => { h.user = { athleteId, isStaff, isSuperUser: false, email: 'x@test' }; };
const hide = (...f: string[]) => { h.feed = { data: [{ payload: { hiddenFields: f } }], error: null }; };

async function laps() {
  const { GET } = await import('@/app/api/run-chat/laps/route');
  const { NextRequest } = await import('next/server');
  const res = await GET(new NextRequest(`http://x/api/run-chat/laps?activityId=${ACT}`));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => { h.feed = { data: [], error: null }; h.feedThrows = false; });

describe('run-chat/laps — hidden pace and heart rate', () => {
  it('teammate: hidden pace nulls speed and lap times; hidden HR nulls lap HR; neither max_speed nor max_heartrate is ever shipped; distance stays', async () => {
    as('teammate'); hide('pace', 'heart_rate');
    const { status, body } = await laps();
    expect(status).toBe(200);
    expect(body.paceHidden).toBe(true);
    expect(body.hrHidden).toBe(true);
    for (const lap of body.laps) {
      expect(lap.distance).toBe(1000);
      expect(lap.average_speed).toBeNull();
      expect(lap.moving_time).toBeNull();
      expect(lap.elapsed_time).toBeNull();
      expect(lap.average_heartrate).toBeNull();
      expect(lap).not.toHaveProperty('max_heartrate');
      expect(lap).not.toHaveProperty('max_speed');
    }
  });

  it('teammate: only HR hidden keeps pace', async () => {
    as('teammate'); hide('heart_rate');
    const { body } = await laps();
    expect(body.paceHidden).toBe(false);
    expect(body.hrHidden).toBe(true);
    expect(body.laps[0].average_speed).toBe(4.17);
    expect(body.laps[0].moving_time).toBe(240);
    expect(body.laps[0].average_heartrate).toBeNull();
  });

  it('teammate with nothing hidden sees everything', async () => {
    as('teammate');
    const { body } = await laps();
    expect(body.paceHidden).toBe(false);
    expect(body.laps[0].average_heartrate).toBe(160);
  });

  it.each([['owner', OWNER, false], ['staff', 'coach', true]] as const)('%s is unmasked', async (_n, id, staff) => {
    as(id, staff); hide('pace', 'heart_rate');
    const { body } = await laps();
    expect(body.paceHidden).toBe(false);
    expect(body.hrHidden).toBe(false);
    expect(body.laps[0].average_speed).toBe(4.17);
    expect(body.laps[0].moving_time).toBe(240);
    expect(body.laps[0].average_heartrate).toBe(160);
  });

  it.each([['error', false], ['throw', true]] as const)('failed hidden-fields read (%s) masks everything for a teammate', async (_n, throws) => {
    as('teammate');
    h.feed = { data: null, error: { message: 'down' } };
    h.feedThrows = throws;
    const { body } = await laps();
    expect(body.paceHidden).toBe(true);
    expect(body.hrHidden).toBe(true);
    expect(body.laps[0].average_speed).toBeNull();
    expect(body.laps[0].average_heartrate).toBeNull();
  });
});
