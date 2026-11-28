import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from './perf-budget/fake-db';
import { NOW, STAFF_ID, seedClub } from './perf-budget/seed';

/**
 * Task 102 — the web asks for the narrow shapes; the defaults (which the native app
 * reads) are unchanged. Sizes are pinned in perf-budget/budget.json; this file pins
 * the shapes and which web callers use them.
 */
const tables = seedClub();
const db = fakeDb(tables);
const RUNNER_ID = String(tables.athletes[2].id);

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db, createServerClientWithAuth: async () => db }));
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

async function get(load: () => Promise<{ GET(req: Request): Promise<Response> }>, path: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  try {
    const { GET } = await load();
    const res = await GET(new Request(`http://localhost${path}`, { headers: { authorization: 'Bearer test' } }));
    expect(res.status).toBe(200);
    return res.json();
  } finally {
    vi.useRealTimers();
  }
}
const activities = () => import('@/app/api/activities/route');
const records = () => import('@/app/api/club/records/route');

describe('GET /api/activities?shape=list', () => {
  it('drops splits/laps, keeps what the web list readers use (calories included)', async () => {
    const { activities: rows } = await get(activities, `/api/activities?athleteId=${RUNNER_ID}&scope=self&limit=5&shape=list`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r).not.toHaveProperty('splits');
      expect(r).not.toHaveProperty('laps');
      for (const k of ['id', 'athlete_id', 'activity_name', 'activity_type', 'start_time', 'distance', 'duration', 'average_pace', 'elevation_gain', 'calories', 'athlete_name']) {
        expect(r, k).toHaveProperty(k);
      }
    }
  });

  it('the default shape still carries splits and laps (native readers)', async () => {
    const { activities: rows } = await get(activities, `/api/activities?athleteId=${RUNNER_ID}&scope=self&limit=5`);
    expect(rows[0]).toHaveProperty('splits');
    expect(rows[0]).toHaveProperty('laps');
  });
});

describe('GET /api/club/records?view=buckets', () => {
  it('answers buckets only, with the same visible entries as the default', async () => {
    const full = await get(records, '/api/club/records');
    const lean = await get(records, '/api/club/records?view=buckets');
    expect(lean.buckets).toEqual(full.buckets);
    for (const k of ['tables', 'history', 'b2000', 'ageBands', 'breaks']) expect(lean, k).not.toHaveProperty(k);
    expect(lean.computedAt).toBe(full.computedAt);
  });

  it('the default still answers tables/history/b2000 (native שיאים tab)', async () => {
    const full = await get(records, '/api/club/records');
    for (const k of ['buckets', 'tables', 'history', 'b2000', 'ageBands']) expect(full, k).toHaveProperty(k);
  });
});

describe('web callers ask for the narrow shapes', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it.each([
    'src/app/(app)/dashboard/records/page.tsx',
    'src/components/PrBadge.tsx',
    'src/components/profile/AthleteProfileBody.tsx',
  ])('%s reads club records with view=buckets', (p) => {
    expect(src(p)).toContain("'/api/club/records?view=buckets'");
    expect(src(p)).not.toMatch(/'\/api\/club\/records'/);
  });

  it.each([
    ['src/app/(app)/dashboard/page.tsx', 3],
    ['src/app/(app)/dashboard/profile/page.tsx', 1],
    ['src/app/(app)/dashboard/share/page.tsx', 2],
    ['src/components/feed/WeekSummaryCard.tsx', 1],
  ])('%s uses listOnly on every fetchActivities call', (p, n) => {
    const s = src(p);
    const calls = s.match(/fetchActivities\(\{[^}]*\}\)/g) ?? [];
    expect(calls.length).toBe(n);
    for (const c of calls) expect(c).toContain('listOnly: true');
  });
});
