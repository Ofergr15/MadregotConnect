import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/athletes/summary walks the athlete's whole history (all-time totals). Measured here with
 * a synthetic history and a fixed per-page latency: page calls, sequential round-trip waves, and that
 * the all-time totals stay exact past the 1000-row PostgREST ceiling. No real database.
 */

const PAGE_MS = 40;
const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], calls: 0, inFlight: 0, waves: 0 }));

vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/self-or-staff')>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: 'a1', isStaff: false, isSuperUser: false, email: 'a@example.test' } }),
}));
vi.mock('@/lib/athletes/week-pref', () => ({ readWeekStartDay: async () => 1 }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const c: any = {};
      for (const m of ['select', 'eq', 'order']) c[m] = () => c;
      c.range = (from: number, to: number) => ({
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
          h.calls++;
          if (h.inFlight++ === 0) h.waves++;
          return new Promise((r) => setTimeout(r, PAGE_MS))
            .then(() => { h.inFlight--; return { data: h.rows.slice(from, to + 1), error: null }; })
            .then(res, rej);
        },
      });
      return c;
    },
  }),
}));

const { GET } = await import('@/app/api/athletes/summary/route');

/** n runs of 10 km / 3000 s, one per day going back from 2026-11-19. */
const history = (n: number) => Array.from({ length: n }, (_, i) => ({
  activity_type: 'running',
  start_time: new Date(Date.UTC(2026, 10, 19, 6) - i * 86400_000).toISOString(),
  distance: 10_000, duration: 3000,
}));

async function measure(n: number) {
  h.rows = history(n); h.calls = 0; h.inFlight = 0; h.waves = 0;
  const t0 = performance.now();
  const res = await GET(new Request('http://x/api/athletes/summary?athleteId=a1'));
  const ms = performance.now() - t0;
  return { body: await res.json(), calls: h.calls, waves: h.waves, ms };
}

beforeEach(() => { h.rows = []; });

describe('athletes/summary — paging cost and all-time correctness (synthetic, ' + PAGE_MS + ' ms/page)', () => {
  const table: string[] = [];
  for (const [n, maxCalls, maxWaves] of [[400, 1, 1], [1000, 9, 2], [3300, 9, 2], [9000, 17, 3]] as const) {
    it(`${n} runs: ≤${maxCalls} page calls, ≤${maxWaves} sequential waves, exact totals`, async () => {
      const m = await measure(n);
      table.push(`${n} runs → ${m.calls} calls, ${m.waves} waves, ${Math.round(m.ms)} ms`);
      expect(m.body.totalRuns).toBe(n);
      expect(m.body.totalKm).toBe(n * 10);
      expect(m.body.totalHours).toBe(Math.round((n * 3000 / 3600) * 10) / 10);
      expect(m.calls).toBeLessThanOrEqual(maxCalls);
      expect(m.waves).toBeLessThanOrEqual(maxWaves);
      expect(m.ms).toBeLessThan(PAGE_MS * (maxWaves + 2));
    });
  }
  it('prints the measurement table', () => { console.log('\n' + table.join('\n')); expect(table).toHaveLength(4); });
});
