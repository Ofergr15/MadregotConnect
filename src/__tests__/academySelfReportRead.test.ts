import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDaysToDateStr, israelToday } from '@/lib/utils';

/** academy-pack §2 (GET own reports) and §3 (same-day edit lock on POST). */
let denied: Response | null = null;
let caller: { athleteId: string | null } = { athleteId: 't1' };
let rows: any[] = [];
let readError: any = null;
const eqs: Array<[string, unknown]> = [];
const upserts: any[] = [];

vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: async () => ({ denied, caller }) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const f: Array<[string, unknown]> = [];
      const q: any = {
        select: () => q, gte: () => q, lte: () => q, order: () => q,
        eq: (c: string, v: unknown) => { f.push([c, v]); eqs.push([c, v]); return q; },
        upsert: async (r: any) => { upserts.push(r); return { error: null }; },
        maybeSingle: async () => {
          if (table === 'athletes') return { data: { is_academy: true }, error: null };
          const date = f.find(([c]) => c === 'workout_date')?.[1];
          return { data: rows.find((r) => r.workout_date === date) ?? null, error: readError };
        },
        then: (ok: any) => Promise.resolve({ data: readError ? null : rows, error: readError }).then(ok),
      };
      return q;
    },
  }),
}));

const { GET, POST } = await import('@/app/api/academy/self-report/route');
const get = (qs: string) => GET(new Request(`http://x/api/academy/self-report?${qs}`));
const post = (body: unknown) => POST(new Request('http://x/api/academy/self-report', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => { denied = null; caller = { athleteId: 't1' }; rows = []; readError = null; eqs.length = 0; upserts.length = 0; });

describe('GET /api/academy/self-report', () => {
  it('reads only the caller, ignoring any athleteId', async () => {
    rows = [{ workout_date: '2026-11-18', activity_id: null, rpe: 6, effort: 'right', pain: false, pain_area: null, pain_level: null, note: null }];
    const r = await get('from=2026-11-01&to=2026-11-30&athleteId=t2');
    expect(r.status).toBe(200);
    expect(eqs).toEqual([['athlete_id', 't1']]);
    expect(await r.json()).toEqual({ reports: [{ workoutDate: '2026-11-18', activityId: null, rpe: 6, effort: 'right', pain: false, painArea: null, painLevel: null, note: '' }] });
  });
  it('400 on bad dates, reversed or >62-day ranges', async () => {
    for (const qs of ['from=2026-11-01', 'from=2026-13-01&to=2026-12-01', 'from=2026-02-30&to=2026-03-01', 'from=2026-11-10&to=2026-11-01', 'from=2026-01-01&to=2026-03-04']) {
      expect((await get(qs)).status, qs).toBe(400);
    }
    expect((await get('from=2026-01-01&to=2026-03-03')).status).toBe(200);
  });
  it('gate first; 403 without an athlete; 503 before migration 188', async () => {
    denied = new Response(null, { status: 401 });
    expect((await get('from=2026-11-01&to=2026-11-02')).status).toBe(401);
    denied = null; caller = { athleteId: null };
    expect((await get('from=2026-11-01&to=2026-11-02')).status).toBe(403);
    caller = { athleteId: 't1' }; readError = { code: '42P01', message: 'relation "academy_trainee_reports" does not exist' };
    expect(await (await get('from=2026-11-01&to=2026-11-02')).json()).toEqual({ error: 'migration_pending' });
  });
});

describe('POST same-day lock (§3)', () => {
  const today = israelToday();
  const yesterday = addDaysToDateStr(today, -1);
  it('today can be corrected', async () => {
    rows = [{ workout_date: today }];
    expect((await post({ workoutDate: today, rpe: 5 })).status).toBe(200);
  });
  it('a past day with a report already is locked', async () => {
    rows = [{ workout_date: yesterday }];
    const r = await post({ workoutDate: yesterday, rpe: 5 });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'locked' });
    expect(upserts).toHaveLength(0);
  });
  it('a first report for a past day is still accepted', async () => {
    expect((await post({ workoutDate: yesterday, rpe: 5 })).status).toBe(200);
    expect(upserts).toHaveLength(1);
  });
});
