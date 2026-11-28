import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Task 194: reads that could pass PostgREST's silent 1000-row cap, each now paged.
 * The fake below behaves like the real server: no `.range()` → at most 1000 rows,
 * so every assertion here fails against the old unpaged read.
 * (garmin history-backfill's case lives in garminHistoryBackfill.test.ts.)
 */
type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, inLengths: [] as number[] }));

function builder(table: string) {
  const eqs: Array<[string, unknown]> = [];
  const ins: Array<[string, unknown[]]> = [];
  const orders: Array<[string, boolean]> = [];
  let rng: [number, number] | null = null;
  const run = () => {
    let rows = (h.tables[table] || []).filter((r) => eqs.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c])));
    rows = [...rows].sort((a, b) => {
      for (const [c, asc] of orders) {
        if (a[c] === b[c]) continue;
        return ((a[c] as string) < (b[c] as string) ? -1 : 1) * (asc ? 1 : -1);
      }
      return 0;
    });
    return { data: rng ? rows.slice(rng[0], rng[1] + 1) : rows.slice(0, 1000), error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { eqs.push([c, v]); return b; },
    in: (c: string, vs: unknown[]) => { ins.push([c, vs]); h.inLengths.push(vs.length); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { orders.push([c, o?.ascending !== false]); return b; },
    range: (f: number, t: number) => { rng = [f, t]; return b; },
    returns: () => b,
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/auth/self-or-staff', () => ({ requireMember: async () => null, requireStaff: async () => null }));

const COACH = (await import('@/lib/constants')).COACH_ID;
const weeks = await import('@/app/api/plans/weeks/route');
const history = await import('@/app/api/plans/history/route');

/** n distinct weeks, newest first when sorted descending. */
const weekOf = (i: number) => new Date(Date.UTC(2000, 0, 2) + i * 7 * 86_400_000).toISOString().slice(0, 10);
const plans = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `p${String(i).padStart(5, '0')}`, coach_id: COACH, week_start_date: weekOf(i), status: 'pushed', created_at: '2026-01-01', parsed_workouts: null,
}));

beforeEach(() => { h.tables = {}; h.inLengths = []; });

describe('GET /api/plans/weeks', () => {
  it('lists every week, including the oldest, past 1000 rows', async () => {
    h.tables.weekly_plans = plans(1300);
    const { weekStarts } = await (await weeks.GET(new Request('http://x'))).json();
    expect(weekStarts).toHaveLength(1300);
    expect(weekStarts[0]).toBe(weekOf(1299));
    expect(weekStarts[1299]).toBe(weekOf(0));
  });
});

describe('GET /api/plans/history', () => {
  it('lists every plan and counts every delivery, past 1000 of each', async () => {
    h.tables.weekly_plans = plans(1100);
    // 3 deliveries per plan = 3300 rows.
    h.tables.workout_deliveries = h.tables.weekly_plans.flatMap((p, i) => [0, 1, 2].map((k) => ({
      id: `d${String(i * 3 + k).padStart(6, '0')}`, plan_id: p.id, status: k === 2 ? 'failed' : 'success',
    })));
    const res = await history.GET(new Request('http://x/api/plans/history') as never);
    const body = await res.json();
    expect(body.plans).toHaveLength(1100);
    for (const p of body.plans) expect(p.delivery_stats).toEqual({ total: 3, success: 2, failed: 1, pending: 0 });
    // Plan ids go out in chunks, never one 1100-id URL.
    expect(Math.max(...h.inLengths)).toBeLessThanOrEqual(150);
  });
});

describe('the other paged reads (source-level: their routes need a Strava/Garmin round trip to drive)', () => {
  it('strava sync reads the athlete\'s stored rows through fetchAllRows, ordered by id', () => {
    const src = readFileSync('src/app/api/strava/sync-activities/route.ts', 'utf8');
    expect(src).toMatch(/const readExisting = \(cols: string\) => fetchAllRows<ExistingRow>\(\(from, to\) => supabase\s+\.from\('athlete_activities'\)\s+\.select\(cols\)\s+\.eq\('athlete_id', athlete\.id\)\s+\.order\('id'\)\s+\.range\(from, to\)/);
  });
  it('the academy library import reads every coach week through fetchAllRows', () => {
    const src = readFileSync('src/app/api/academy/library/import/route.ts', 'utf8');
    expect(src).toMatch(/fetchAllRows<Record<string, unknown>>\(\(from, to\) => supabase\s+\.from\('weekly_plans'\)[\s\S]{0,200}\.order\('id'\)\s+\.range\(from, to\)\)/);
  });
});
