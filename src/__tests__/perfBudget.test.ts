import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeDb } from './perf-budget/fake-db';
import { NOW, STAFF_ID, seedClub } from './perf-budget/seed';
import BUDGET from './perf-budget/budget.json';

/**
 * Response-size budget (task 67). Calls the 10 main GET routes against one seeded
 * club (perf-budget/seed.ts, ≈60 members, 6 weeks of runs) and fails when a JSON
 * body grows past its budget in perf-budget/budget.json. Runs in CI with `npm test`.
 *
 * The number is the UTF-8 byte length of the body as the route returns it (before
 * gzip): what the phone parses and what swr-persist writes to localStorage.
 *
 * A breach is a question, not automatically a bug: if the growth is intended, raise
 * the budget in the same PR and say why. `npm run perf:budget` writes every size to
 * /tmp/perf-budget.json.
 */

const tables = seedClub();
const db = fakeDb(tables);
const RUNNER_ID = String(tables.athletes[2].id);

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => db,
  createServerClientWithAuth: async () => db,
}));
vi.mock('@/lib/auth-session', async (orig) => {
  const real = await orig<typeof import('@/lib/auth-session')>();
  return {
    ...real,
    requireSession: async () => ({
      ok: true as const,
      user: {
        email: 'runner0@example.test', athleteEmail: 'runner0@example.test', athleteId: STAFF_ID, name: 'Runner 0',
        role: 'admin', roles: ['admin'], groupId: String(tables.groups[0].id), athleteStatus: 'active', membership: 'member',
        isStaff: true, isSuperUser: false, canApprove: true, isCoreRunner: false,
      },
    }),
  };
});

type Probe = { name: string; path: string; params?: Record<string, string>; // Method syntax on purpose: each route types its own `params`, and methods are bivariant.
  load: () => Promise<{ GET(req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> }> };

const ROUTES: Probe[] = [
  { name: 'feed', path: '/api/feed', load: () => import('@/app/api/feed/route') },
  { name: 'dashboard/weekly', path: '/api/dashboard/weekly', load: () => import('@/app/api/dashboard/weekly/route') },
  { name: 'athletes', path: '/api/athletes', load: () => import('@/app/api/athletes/route') },
  { name: 'activities', path: `/api/activities?athleteId=${RUNNER_ID}`, load: () => import('@/app/api/activities/route') },
  { name: 'club/records', path: '/api/club/records', load: () => import('@/app/api/club/records/route') },
  { name: 'events', path: '/api/events', load: () => import('@/app/api/events/route') },
  { name: 'academy/members', path: '/api/academy/members', load: () => import('@/app/api/academy/members/route') },
  { name: 'groups', path: '/api/groups', load: () => import('@/app/api/groups/route') },
  { name: 'athletes/[id]/stats', path: `/api/athletes/${RUNNER_ID}/stats`, params: { id: RUNNER_ID }, load: () => import('@/app/api/athletes/[id]/stats/route') },
  { name: 'club-updates', path: '/api/club-updates', load: () => import('@/app/api/club-updates/route') },
  // The narrow shapes the web asks for since task 102 (the rows above are the
  // defaults, which the native app still reads).
  { name: 'activities (web list, 30 own)', path: `/api/activities?athleteId=${RUNNER_ID}&scope=self&limit=30&shape=list`, load: () => import('@/app/api/activities/route') },
  { name: 'club/records (web buckets)', path: '/api/club/records?view=buckets', load: () => import('@/app/api/club/records/route') },
];

const sizes: Record<string, { status: number; bytes: number }> = {};

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  for (const r of ROUTES) {
    try {
      const { GET } = await r.load();
      const res = await GET(new Request(`http://localhost${r.path}`, { headers: { authorization: 'Bearer test' } }), { params: Promise.resolve(r.params || {}) });
      const body = await res.text();
      sizes[r.name] = { status: res.status, bytes: Buffer.byteLength(body, "utf8") };
    } catch (e) {
      sizes[r.name] = { status: -1, bytes: 0 };
      sizes[r.name] = { status: -1, bytes: 0, error: String(e) } as never;
    }
  }
  // vitest hides console output of passing files, so the report goes to a file.
  if (process.env.PERF_BUDGET_REPORT) writeFileSync(process.env.PERF_BUDGET_REPORT, `${JSON.stringify(sizes, null, 2)}\n`);
}, 60_000);

afterAll(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('API response-size budget', () => {
  for (const [name, budget] of Object.entries(BUDGET as Record<string, number>)) {
    it(`${name} ≤ ${budget} bytes`, () => {
      const s = sizes[name];
      expect(s, `${name} was not measured`).toBeDefined();
      expect(s.status, `${name} did not answer 200 on the seeded club`).toBe(200);
      expect(s.bytes, `${name} is ${s.bytes} bytes, budget ${budget}`).toBeLessThanOrEqual(budget);
    });
  }
});
