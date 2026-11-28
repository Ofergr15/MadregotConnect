// Task 93: each cron writes a cron_runs row (start, end, counts, error); staff GET reads them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = Record<string, unknown>;
let rows: Row[] = [];
let missing = false;
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from() {
      let mode = 'select'; let patch: Row = {}; const filters: Array<[string, unknown]> = [];
      const q: any = {
        insert: (r: Row) => { mode = 'insert'; patch = r; return q; },
        update: (p: Row) => { mode = 'update'; patch = p; return q; },
        delete: () => { mode = 'delete'; return q; },
        select: () => q, order: () => q, limit: () => q, lt: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
        single: async () => {
          if (missing) return { data: null, error: { code: '42P01', message: 'relation "cron_runs" does not exist' } };
          const row = { id: `r${rows.length + 1}`, ...patch }; rows.push(row); return { data: row, error: null };
        },
        then: (res: (v: unknown) => unknown) => {
          if (mode === 'update') { const r = rows.find((x) => x.id === filters.find(([k]) => k === 'id')?.[1]); if (r) Object.assign(r, patch); }
          if (missing) return Promise.resolve({ data: null, error: { code: '42P01' } }).then(res);
          return Promise.resolve({ data: rows, error: null }).then(res);
        },
      };
      return q;
    },
  }),
}));
const requireStaff = vi.fn(async () => null as Response | null);
const staffCaller = vi.fn(async () => ({ denied: new Response(null, { status: 401 }) as Response | null, caller: { athleteId: null as string | null } }));
vi.mock('@/lib/auth/self-or-staff', () => ({ requireStaff: () => requireStaff(), requireStaffCaller: () => staffCaller() }));
const runs = await import('@/lib/cron/runs');
const { GET } = await import('@/app/api/admin/cron-runs/route');

const req = (auth?: string) => new Request('http://x/api/cron/x', { headers: auth ? { authorization: auth } : {} });
beforeEach(() => { rows = []; missing = false; process.env.CRON_SECRET = 's3cret'; staffCaller.mockClear(); });
afterEach(() => { delete process.env.CRON_SECRET; vi.restoreAllMocks(); });

describe('withCronRun', () => {
  it('writes a start row and finishes it with ok, status and top-level counts', async () => {
    const h = runs.withCronRun('badges', async () => Response.json({ evaluated: 12, awarded: 3, paused: false, note: 'x', ids: [1, 2] }));
    const res = await h(req('Bearer s3cret'));
    expect(await res.json()).toMatchObject({ evaluated: 12 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'badges', ok: true, http_status: 200, counts: { evaluated: 12, awarded: 3, paused: false, idsCount: 2 } });
    expect(rows[0].finished_at).toBeTruthy();
  });
  it('a throw is recorded and re-thrown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = runs.withCronRun('sync', async () => { throw new Error('garmin down'); });
    await expect(h(req('Bearer s3cret'))).rejects.toThrow('garmin down');
    expect(rows[0]).toMatchObject({ ok: false, http_status: 500, error: 'Error: garmin down' });
  });
  it('an unauthorized call writes nothing and still gets the handler reply', async () => {
    const h = runs.withCronRun('tick', async () => new Response(null, { status: 401 }));
    expect((await h(req('Bearer wrong'))).status).toBe(401);
    expect(rows).toHaveLength(0);
  });
  it('a staff POST without the secret runs as the cron and is recorded as manual, with who', async () => {
    staffCaller.mockResolvedValueOnce({ denied: null, caller: { athleteId: 'ath-7' } });
    let seen: string | null = null;
    const h = runs.withCronRun('badges', async (r: Request) => { seen = r.headers.get('authorization'); return Response.json({ awarded: 2 }); });
    const res = await h(new Request('http://x/api/cron/badges', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(seen).toBe('Bearer s3cret');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'badges', ok: true, counts: { awarded: 2, trigger: 'manual', staff_athlete_id: 'ath-7' } });
    expect(runs.isManualRun(rows[0].counts)).toBe(true);
  });
  it('a scheduled run carries no manual mark', async () => {
    const h = runs.withCronRun('badges', async () => Response.json({ awarded: 1 }));
    await h(req('Bearer s3cret'));
    expect(runs.isManualRun(rows[0].counts)).toBe(false);
    expect(staffCaller).not.toHaveBeenCalled();
  });
  it('a staff GET (a link) or a non-staff POST is not a manual run: nothing recorded', async () => {
    staffCaller.mockResolvedValue({ denied: null, caller: { athleteId: 'ath-7' } });
    const h = runs.withCronRun('tick', async () => new Response(null, { status: 401 }));
    expect((await h(new Request('http://x/api/cron/tick'))).status).toBe(401);
    staffCaller.mockResolvedValue({ denied: new Response(null, { status: 403 }), caller: { athleteId: 'ath-1' } });
    expect((await h(new Request('http://x/api/cron/tick', { method: 'POST' }))).status).toBe(401);
    expect(rows).toHaveLength(0);
    staffCaller.mockReset();
    staffCaller.mockImplementation(async () => ({ denied: new Response(null, { status: 401 }), caller: { athleteId: null } }));
  });
  it('before migration 251 the cron runs exactly as before', async () => {
    missing = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = runs.withCronRun('tick', async () => Response.json({ ok: true }));
    expect((await h(req('Bearer s3cret'))).status).toBe(200);
    expect(err).not.toHaveBeenCalled();
  });
  it('countsOf / errorText edge cases', () => {
    expect(runs.countsOf(null)).toBeNull();
    expect(runs.countsOf([1])).toBeNull();
    expect(runs.countsOf({ a: NaN, b: 'x' })).toBeNull();
    expect(runs.errorText('x'.repeat(900))).toHaveLength(500);
  });
});

describe('every cron is wrapped', () => {
  const base = join(process.cwd(), 'src/app/api/cron');
  for (const name of readdirSync(base)) {
    it(`/api/cron/${name} exports through withCronRun('${name}')`, () => {
      const src = readFileSync(join(base, name, 'route.ts'), 'utf8');
      const exported = src.match(/^export (const|async function) (GET|POST)\b.*$/gm) ?? [];
      expect(exported.length).toBeGreaterThan(0);
      for (const line of exported) expect(line).toContain(`withCronRun('${name}'`);
    });
  }
});

describe('GET /api/admin/cron-runs', () => {
  it('staff-only', async () => {
    requireStaff.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await GET(new Request('http://x'))).status).toBe(403);
  });
  it('summarizes last run per cron, flags an open (never finished) run', async () => {
    rows = [
      { name: 'tick', started_at: '2026-11-28T10:00:00Z', finished_at: null, ok: null, http_status: null, counts: null, error: null },
      { name: 'tick', started_at: '2026-11-28T09:00:00Z', finished_at: '2026-11-28T09:01:00Z', ok: false, http_status: 500, counts: null, error: 'e' },
      { name: 'badges', started_at: '2026-11-28T03:00:00Z', finished_at: '2026-11-28T03:02:00Z', ok: true, http_status: 200, counts: { n: 1, trigger: 'manual', staff_athlete_id: 'a' }, error: null },
    ];
    const body = await (await GET(new Request('http://x'))).json();
    expect(body.summary.map((s: { name: string; open: boolean; failedRecently: number; manualRecently: number }) => [s.name, s.open, s.failedRecently, s.manualRecently])).toEqual([['badges', false, 0, 1], ['tick', true, 1, 0]]);
  });
  it('503 before the migration', async () => {
    missing = true;
    expect((await GET(new Request('http://x'))).status).toBe(503);
  });
});
