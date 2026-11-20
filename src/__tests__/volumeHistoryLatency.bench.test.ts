// FIXTURE benchmark — synthetic rows and a synthetic 100 ms per-query delay.
// Not production data, not production latency.
import { describe, it, expect, vi } from 'vitest';

const DELAY = 100;
const log: { table: string; at: number }[] = [];
let t0 = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ROWS = Array.from({ length: 2500 }, (_, i) => ({
  id: `a${String(i).padStart(5, '0')}`, athlete_id: 'ath1',
  start_time: new Date(Date.now() - i * 3.5 * 3600e3).toISOString(),
  distance: 10000, duration: 3000, activity_type: 'running',
}));

function builder(table: string) {
  let from = 0, to = Infinity;
  const b: any = new Proxy({}, {
    get(_, k) {
      if (k === 'then') return (res: any, rej: any) => {
        log.push({ table, at: Date.now() - t0 });
        return sleep(DELAY).then(() => {
          if (table === 'athlete_activities') return { data: ROWS.slice(from, to + 1), error: null };
          if (table === 'athletes') return { data: { week_start_day: 1 }, error: null };
          return { data: [], error: null };
        }).then(res, rej);
      };
      if (k === 'range') return (a: number, z: number) => { from = a; to = z; return b; };
      return () => b;
    },
  });
  return b;
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => { log.push({ table: 'AUTH', at: Date.now() - t0 }); await sleep(DELAY); return { denied: null, caller: { athleteId: 'ath1' } }; },
  mayActFor: () => true,
}));

describe('volume-history latency (fixture, 100 ms/query)', () => {
  it('weeks=52', async () => {
    const { GET } = await import('@/app/api/athletes/volume-history/route');
    t0 = Date.now(); log.length = 0;
    const res = await GET(new Request('http://x/api/athletes/volume-history?athleteId=ath1&weeks=52'));
    const total = Date.now() - t0;
    const body = await res.json();
    console.log(`BENCH status=${res.status} total=${total}ms queries=${log.length} starts=${log.map((l) => `${l.table}@${l.at}`).join(',')} series=${body.series?.length}`);
    expect(res.status).toBe(200);
  });
});
