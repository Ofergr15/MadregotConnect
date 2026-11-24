// Night queue #80: GET /api/me/plan-history — the caller's own past weeks, by the same rules the week screen reads with.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
let auth: any = { ok: true, user: { athleteId: ME } };
vi.mock('@/lib/auth-session', () => ({
  requireAthlete: async () => auth,
  authError: () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
}));
let ownCount = true, academyOnly = false;
vi.mock('@/lib/plans/scope-server', async (orig) => ({
  ...(await orig<any>()),
  ownPlanRowsCount: async () => ownCount,
  academyOnlyReader: async () => academyOnly,
}));
const wk = (name: string, km = 10) => ({ workouts: [{ dayOfWeek: 2, name, steps: [], totalDistance: km * 1000 }] });
let rows: any[] = [];
let orFilter = '';
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const q: any = {
        select: () => q, eq: () => q, order: () => q,
        or: (f: string) => { orFilter = f; return q; },
        limit: (n: number) => Promise.resolve({
          data: rows.filter((r) => r.athlete_id === null || orFilter.includes(String(r.athlete_id)))
            .sort((a, b) => b.week_start_date.localeCompare(a.week_start_date)).slice(0, n),
          error: null,
        }),
      };
      return q;
    },
  }),
}));

const { GET } = await import('@/app/api/me/plan-history/route');
const get = async (qs = '') => { const r = await GET(new Request(`http://x/api/me/plan-history${qs}`)); return { status: r.status, body: await r.json() }; };

beforeEach(() => {
  auth = { ok: true, user: { athleteId: ME } }; ownCount = true; academyOnly = false;
  rows = [
    { id: 'c1', week_start_date: '2026-11-08', athlete_id: null, status: 'pushed', created_at: '1', parsed_workouts: wk('club 8.11') },
    { id: 'c2', week_start_date: '2026-11-15', athlete_id: null, status: 'pushed', created_at: '2', parsed_workouts: wk('club 15.11') },
    { id: 'm2', week_start_date: '2026-11-15', athlete_id: ME, status: 'pushed', created_at: '3', parsed_workouts: wk('mine 15.11', 12) },
    { id: 'd3', week_start_date: '2026-11-22', athlete_id: null, status: 'draft', created_at: '4', parsed_workouts: wk('draft') },
    { id: 'o2', week_start_date: '2026-11-15', athlete_id: OTHER, status: 'pushed', created_at: '5', parsed_workouts: wk('other') },
  ];
});

describe('GET /api/me/plan-history', () => {
  it('only the caller: own week beats the club week, drafts and other trainees never appear, newest first', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.weeks.map((w: any) => [w.weekStart, w.planId, w.own])).toEqual([['2026-11-15', 'm2', true], ['2026-11-08', 'c1', false]]);
    expect(JSON.stringify(body)).not.toMatch(/other|draft/);
    expect(orFilter).toContain(ME);
    expect(orFilter).not.toContain(OTHER);
  });
  it('carries the workouts and the week total as a km range', async () => {
    const { body } = await get();
    expect(body.weeks[0].workouts[0]).toMatchObject({ dayOfWeek: 2, name: 'mine 15.11' });
    expect(typeof body.weeks[0].totalKmMin).toBe('number');
    expect(body.weeks[0].totalKmMax).toBeGreaterThanOrEqual(body.weeks[0].totalKmMin);
  });
  it('an academy-only reader gets only their own weeks', async () => {
    academyOnly = true;
    const { body } = await get();
    expect(body.weeks.map((w: any) => w.planId)).toEqual(['m2']);
  });
  it('weeks is capped and clamped', async () => {
    expect((await get('?weeks=1')).body.weeks).toHaveLength(1);
    expect((await get('?weeks=abc')).status).toBe(200);
  });
  it('no session → 401, nothing read', async () => {
    auth = { ok: false };
    orFilter = '';
    expect((await get()).status).toBe(401);
    expect(orFilter).toBe('');
  });
});
