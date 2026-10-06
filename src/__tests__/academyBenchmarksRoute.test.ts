import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * GET /api/academy/benchmarks — the approved board is public; the pending queue and
 * `status=all` name results nobody has vetted, so they are staff's — plus the athlete
 * asking for their OWN (ProfileBest), checked against the session.
 */

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = { benchmark_results: [], athletes: [] };

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Array<(r: Row) => boolean> = [];
  private single = false;
  constructor(private table: string) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this; }
  ilike(c: string, v: string) { this.filters.push(r => String(r[c]).toLowerCase() === v.toLowerCase()); return this; }
  order() { return this; }
  maybeSingle() { this.single = true; return this; }
  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    ok?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    bad?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const rows = (db[this.table] || []).filter(r => this.filters.every(f => f(r)));
    return Promise.resolve({ data: this.single ? rows[0] ?? null : rows, error: null }).then(ok, bad);
  }
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => new Query(t) }) }));
vi.mock('@/lib/constants', () => ({ COACH_ID: 'club' }));

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req),
  mayActFor: () => true,
}));

const { GET } = await import('@/app/api/academy/benchmarks/route');
const get = (q: string) => GET(new Request(`http://x/api/academy/benchmarks?${q}`));

const as = (caller: Row) => resolveVerifiedCaller.mockResolvedValue({
  denied: null, caller: { isSuperUser: false, isStaff: false, athleteId: null, ...caller },
});
const anonymous = () => resolveVerifiedCaller.mockResolvedValue({
  denied: NextResponse.json({ error: 'unauthorized' }, { status: 401 }), caller: {},
});

beforeEach(() => {
  resolveVerifiedCaller.mockReset();
  db.athletes = [{ id: 'a1', coach_id: 'club', name: 'Dor Levi' }, { id: 'a2', coach_id: 'club', name: 'Noa Gal' }];
  db.benchmark_results = [
    { id: 'r1', coach_id: 'club', test_name: '2000m', athlete_name: 'Dor Levi', athlete_id: 'a1', time_seconds: 400, status: 'pending' },
    { id: 'r2', coach_id: 'club', test_name: '2000m', athlete_name: 'Noa Gal', athlete_id: 'a2', time_seconds: 410, status: 'approved' },
    { id: 'r3', coach_id: 'club', test_name: '2000m', athlete_name: 'Noa Gal', athlete_id: 'a2', time_seconds: 390, status: 'pending' },
  ];
});

describe('the approved board stays public', () => {
  it('needs no session', async () => {
    anonymous();
    const body = await (await get('')).json();
    expect(body.results.map((r: Row) => r.id)).toEqual(['r2']);
    expect(resolveVerifiedCaller).not.toHaveBeenCalled();
  });
});

describe('pending and all', () => {
  it('401 without a session', async () => {
    anonymous();
    expect((await get('status=pending')).status).toBe(401);
    expect((await get('status=all')).status).toBe(401);
  });

  it('staff see the whole queue', async () => {
    as({ isStaff: true, athleteId: 'coach' });
    const body = await (await get('status=pending')).json();
    expect(body.results.map((r: Row) => r.id).sort()).toEqual(['r1', 'r3']);
  });

  it('a runner may not read the queue, nor somebody else\'s pending result', async () => {
    as({ athleteId: 'a1' });
    expect((await get('status=pending')).status).toBe(403);
    expect((await get('status=pending&athleteId=a2')).status).toBe(403);
    expect((await get('status=pending&name=Noa%20Gal')).status).toBe(403);
  });

  it('a runner may read their OWN, by id or by their own name', async () => {
    as({ athleteId: 'a1' });
    const byId = await (await get('status=pending&athleteId=a1')).json();
    expect(byId.results.map((r: Row) => r.id)).toEqual(['r1']);
    const byName = await (await get('status=pending&name=%20dor%20levi')).json();
    expect(byName.results.map((r: Row) => r.id)).toEqual(['r1']);
  });
});
