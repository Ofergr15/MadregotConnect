import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Feedback #84: the weekly-km card on the feed cut the week Monday–Sunday even for a member
// whose profile is set to Sunday–Saturday. The card is about one person's own week, so it
// follows `athletes.week_start_day`; these pin both settings and the Monday default.

let weekStartDay: unknown;
let activityFrom: string | undefined;
let planWeek: string | undefined;

vi.mock('@/lib/auth-session', () => ({
  requireSession: async () => ({ ok: true, user: { athleteId: 'a1' } }),
  authError: () => new Response('{}', { status: 401 }),
}));
vi.mock('@/lib/challenges/engine', () => ({ computeChallengeProgress: async () => 0 }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: string) => {
          if (table === 'weekly_plans' && col === 'week_start_date') planWeek = val;
          return chain;
        },
        is: () => chain,
        gte: (col: string, val: string) => {
          if (table === 'athlete_activities') activityFrom = val;
          return chain;
        },
        lt: () => chain,
        lte: () => chain,
        order: () => chain,
        maybeSingle: () => Promise.resolve({ data: { week_start_day: weekStartDay }, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));

const { GET } = await import('@/app/api/feed/highlight/route');
// An empty week renders no card, so the window is read off the queries: activities are
// fetched from a day before the week starts.
const read = async () => { await GET(new Request('https://example.test/api/feed/highlight')); return activityFrom; };

beforeEach(() => {
  activityFrom = undefined; planWeek = undefined;
  vi.useFakeTimers();
  // Wednesday 2026-09-23, midday in Israel.
  vi.setSystemTime(new Date('2026-09-23T09:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('GET /api/feed/highlight week window', () => {
  it('starts on Sunday for a Sunday–Saturday member', async () => {
    weekStartDay = 0;
    expect(await read()).toBe('2026-09-19');
    expect(planWeek).toBe('2026-09-20');
  });

  it('starts on Monday for a Monday member', async () => {
    weekStartDay = 1;
    expect(await read()).toBe('2026-09-20');
  });

  it('defaults to Monday when the preference is unset', async () => {
    weekStartDay = null;
    expect(await read()).toBe('2026-09-20');
  });
});
