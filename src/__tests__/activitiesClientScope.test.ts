import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';

/**
 * The query string fetchActivities builds is the whole contract between the
 * personal screens and /api/activities, and it is invisible: get it wrong and
 * nothing throws — the server just answers a different, wider question and the
 * client filters the surplus away.
 *
 * That is exactly how `scope=self` came to exist. /api/activities hands staff
 * the club-wide list even when an athleteId is named, so `limit: 1` (added so
 * /dashboard/profile stops downloading 200 rows of splits/laps JSONB to set a
 * boolean) returned the club's single newest run — probably somebody else's —
 * and the club's own admin read as having no activities at all. The route tests
 * in verifiedRouteIdentity.test.ts pin the server half; these pin that the
 * client actually asks for it.
 */

vi.mock('@/lib/api', () => ({
  apiHeaders: () => Promise.resolve({ Authorization: 'Bearer test' }),
}));

const ME = '11111111-1111-1111-1111-111111111111';

// Node's the default test environment, and the helper reads athlete_id from
// localStorage behind a `typeof window` guard — so without these it silently
// takes the server-side branch and sends no id, which would make every
// assertion below vacuous.
const store = new Map<string, string>();
const g = globalThis as any;
g.window = g;
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { fetchActivities } = await import('@/lib/activities-client');

let requested: string[] = [];

beforeEach(() => {
  requested = [];
  store.clear();
  store.set('athlete_id', ME);
  g.fetch = vi.fn((url: string) => {
    requested.push(url);
    return Promise.resolve(new Response('{}'));
  });
});

afterAll(() => {
  delete g.window;
  delete g.localStorage;
});

/** The parsed query string of the single request the helper made. */
const params = () => new URL(requested[0], 'https://example.test').searchParams;

describe('fetchActivities', () => {
  it('names the signed-in athlete and asks for nothing else by default', async () => {
    await fetchActivities();
    expect(requested).toHaveLength(1);
    expect([...params()]).toEqual([['athleteId', ME]]);
  });

  it('asks for scope=self so a coach who also runs gets their OWN rows', async () => {
    await fetchActivities({ limit: 1, selfOnly: true });
    expect(params().get('scope')).toBe('self');
    expect(params().get('limit')).toBe('1');
    expect(params().get('athleteId')).toBe(ME);
  });

  // The club feed and the weekly leaderboard want everyone, so this must stay
  // opt-in — a default of self-only would empty both for staff.
  it('leaves scope off unless selfOnly is asked for', async () => {
    for (const options of [{}, { includeGps: true }, { limit: 30 }, { selfOnly: false }]) {
      requested = [];
      await fetchActivities(options);
      expect(params().has('scope'), JSON.stringify(options)).toBe(false);
    }
  });

  it('sends include=gps only for callers that render the route from the list', async () => {
    await fetchActivities({ includeGps: true, selfOnly: true });
    expect(params().get('include')).toBe('gps');
    expect(params().get('scope')).toBe('self');
  });

  // A pure-admin coach has no athlete row, so there's no id to send — the
  // helper must still produce a valid request rather than `athleteId=null`.
  it('omits the id entirely when there is no athlete_id stored', async () => {
    store.delete('athlete_id');
    await fetchActivities({ limit: 30, selfOnly: true });
    expect(params().has('athleteId')).toBe(false);
    expect(requested[0]).toBe('/api/activities?limit=30&scope=self');
  });

  it('drops the question mark when there is nothing to ask', async () => {
    store.delete('athlete_id');
    await fetchActivities();
    expect(requested[0]).toBe('/api/activities');
  });
});
