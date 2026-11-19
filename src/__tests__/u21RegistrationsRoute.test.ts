import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

// GET /api/u21/registrations: admin-only, minimal columns, no raw errors.

type Caller = { isSuperUser: boolean; role: string };
let caller: Caller | 'anon' | 'bad-token';
let result: { data: unknown; error: unknown };
let thrown: Error | null;
let selected: string | null;

vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => {
    if (caller === 'anon') return { denied: NextResponse.json({ error: 'Authentication required' }, { status: 401 }), caller: {} };
    if (caller === 'bad-token') return { denied: NextResponse.json({ error: 'Invalid session' }, { status: 401 }), caller: {} };
    return { denied: null, caller };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => {
    if (thrown) throw thrown;
    const chain: any = {
      select: (cols: string) => { selected = cols; return chain; },
      order: () => chain,
      limit: () => Promise.resolve(result),
    };
    return { from: () => chain };
  },
}));

import { GET, U21_LIST_COLUMNS } from '@/app/api/u21/registrations/route';

const req = () => new Request('http://x/api/u21/registrations');
const row = {
  id: 'r1', first_name: 'בדיקה', last_name: 'סינתטי', age_band: '16-17', track: 'pro',
  red_flag: true, status: 'pending_review', created_at: '2026-11-19T10:00:00Z',
};

describe('GET /api/u21/registrations', () => {
  beforeEach(() => {
    caller = { isSuperUser: false, role: 'admin' };
    result = { data: [row], error: null };
    thrown = null;
    selected = null;
  });

  it('401s an anonymous caller without touching the DB', async () => {
    caller = 'anon';
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(selected).toBeNull();
  });

  it('401s an invalid token', async () => {
    caller = 'bad-token';
    expect((await GET(req())).status).toBe(401);
    expect(selected).toBeNull();
  });

  it.each(['runner', 'core_runner', 'viewer', 'coach', 'academy_coach'])('403s a %s', async role => {
    caller = { isSuperUser: false, role };
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(selected).toBeNull();
  });

  it('lets an admin and a super user read', async () => {
    expect((await GET(req())).status).toBe(200);
    caller = { isSuperUser: true, role: 'runner' };
    expect((await GET(req())).status).toBe(200);
  });

  it('selects only the list columns — no contact, guardian, birth date or intake', async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(selected).toBe(U21_LIST_COLUMNS);
    const cols = U21_LIST_COLUMNS.split(',').map(c => c.trim()).sort();
    expect(cols).toEqual(['age_band', 'created_at', 'first_name', 'id', 'last_name', 'red_flag', 'status', 'track']);
    for (const banned of ['email', 'phone', 'guardian', 'birth', 'intake', 'flag_']) {
      expect(U21_LIST_COLUMNS).not.toContain(banned);
    }
    expect(body).toEqual({ data: [row], ready: true });
  });

  it('redacts a DB error', async () => {
    result = { data: null, error: { code: '42501', message: 'permission denied for table u21_registrations' } };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(req());
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'Could not load' });
    expect(text).not.toMatch(/permission|u21_|42501/);
    spy.mockRestore();
  });

  it('redacts a thrown exception', async () => {
    thrown = new Error('connect ECONNREFUSED db.internal:5432');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(req());
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'Server error' });
    expect(text).not.toMatch(/ECONNREFUSED|internal/);
    spy.mockRestore();
  });

  it('reports an unapplied migration as not ready, with no detail', async () => {
    result = { data: null, error: { code: '42P01', message: 'relation "u21_registrations" does not exist' } };
    const res = await GET(req());
    expect(await res.json()).toEqual({ data: [], ready: false });
  });
});
