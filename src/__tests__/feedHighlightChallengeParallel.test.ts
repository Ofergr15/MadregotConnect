import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/feed/highlight: a challenge's progress (three reads in a row on a group
 * challenge) runs alongside the award + icon reads, not after them — one fewer round
 * trip on the slowest branch of the feed's first card. The card's challenge half is
 * unchanged.
 */

const h = vi.hoisted(() => ({
  events: [] as string[],
  releaseBadges: null as null | (() => void),
  awarded: false,
}));

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user: { athleteId: 'a1' } }),
  authError: () => new Response('{}', { status: 401 }),
}));
vi.mock('@/lib/challenges/engine', () => ({
  computeChallengeProgress: async () => { h.events.push('progress:start'); return 42; },
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const result = (): Promise<unknown> => {
        if (table === 'challenges') {
          return Promise.resolve({ data: [{ id: 'c1', badge_id: 'b1', name_he: 'אתגר', name_en: 'Challenge', metric: 'km', target_value: 100, scope: 'group', start_date: '2026-09-01', end_date: '2026-09-30' }], error: null });
        }
        if (table === 'athlete_badges') {
          h.events.push('awards:start');
          return new Promise((res) => { h.releaseBadges = () => res({ data: h.awarded ? [{ badge_id: 'b1' }] : [], error: null }); });
        }
        if (table === 'badges') return Promise.resolve({ data: [{ id: 'b1', icon: '🏅', icon_url: null }], error: null });
        if (table === 'athlete_activities') {
          return Promise.resolve({ data: [{ id: 'r1', distance: 10000, duration: 3000, start_time: '2026-09-22T07:00:00', activity_type: 'running' }], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      };
      const chain: any = {};
      for (const m of ['select', 'eq', 'is', 'gte', 'lt', 'lte', 'order', 'in', 'limit', 'not', 'or']) chain[m] = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.then = (ok: any, ko: any) => result().then(ok, ko);
      return chain;
    },
  }),
}));

const { GET } = await import('@/app/api/feed/highlight/route');

beforeEach(() => {
  h.events = []; h.releaseBadges = null; h.awarded = false;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-23T09:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('feed highlight: challenge progress alongside the badge reads', () => {
  it('progress has started while the award read is still open', async () => {
    const pending = GET(new Request('https://example.test/api/feed/highlight'));
    await flush();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.events).toContain('awards:start');
    expect(h.events).toContain('progress:start');
    h.releaseBadges!();
    expect((await pending).status).toBe(200);
  });

  it.each([false, true])('challenge half unchanged (awarded=%s)', async (awarded) => {
    h.awarded = awarded;
    const pending = GET(new Request('https://example.test/api/feed/highlight'));
    await new Promise((r) => setTimeout(r, 0));
    h.releaseBadges?.();
    const body = await (await pending).json();
    const c = JSON.stringify(body).includes('"challenge"') ? body.challenge ?? body.highlight?.challenge : null;
    expect(c).toMatchObject({ id: 'c1', current: 42, target: 100, icon: '🏅', done: awarded });
  });
});
