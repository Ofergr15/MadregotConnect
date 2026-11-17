import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// QA 2026-11-17 #3: the feed card labelled the week "16-22 November" (Monday activity
// week) while the plan read "15-21 November". The card now uses the plan week
// (planWeekStartOf, Sunday–Saturday in Israel) whatever the member's preference.

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
  for (const pref of [0, 1, null]) {
    it(`uses the plan's Sunday week (week_start_day=${pref})`, async () => {
      weekStartDay = pref;
      expect(await read()).toBe('2026-09-19');
      expect(planWeek).toBe('2026-09-20');
    });
  }

  it('Sunday 00:30 Israel (still Saturday in UTC) is already the new week', async () => {
    weekStartDay = 1;
    vi.setSystemTime(new Date('2026-11-14T22:30:00Z')); // Sun 15 Nov 00:30 IST
    expect(await read()).toBe('2026-11-14');
    expect(planWeek).toBe('2026-11-15');
  });

  it('Saturday 23:30 Israel stays in the week it closes', async () => {
    weekStartDay = 1;
    vi.setSystemTime(new Date('2026-11-21T21:30:00Z')); // Sat 21 Nov 23:30 IST
    expect(await read()).toBe('2026-11-14');
    expect(planWeek).toBe('2026-11-15');
  });
});
