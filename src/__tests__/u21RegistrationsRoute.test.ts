import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The routes refuse to run unless the server env is the approved dev project (env-guard.ts).
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (payload: Record<string, unknown>) => `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
const APPROVED_REF = 'rtcgklespcwvxashhamh';
const OTHER_REF = 'abcdefghijklmnopqrst';
const APPROVED_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${APPROVED_REF}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role', ref: APPROVED_REF }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon', ref: APPROVED_REF }),
};
const stubEnv = (over: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries({ ...APPROVED_ENV, ...over })) vi.stubEnv(k, v);
};
stubEnv();

import { NextResponse } from 'next/server';

// GET /api/u21/registrations: admin-only, minimal columns, no raw errors.

type Caller = { isSuperUser: boolean; role: string };
let caller: Caller | 'anon' | 'bad-token';
let result: { data: unknown; error: unknown };
let thrown: Error | null;
let selected: string | null;
let authCalls = 0;

vi.mock('@/lib/auth/self-or-staff', () => ({
  resolveVerifiedCaller: async () => {
    authCalls++;
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

describe('env guard', () => {
  afterEach(() => { stubEnv(); vi.restoreAllMocks(); });
  it.each([
    ['a mismatched service key', { SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role', ref: OTHER_REF }) }],
    ['a bad URL', { NEXT_PUBLIC_SUPABASE_URL: `https://${OTHER_REF}.supabase.co` }],
  ])('503s on %s, touches nothing, and logs no ref', async (_l, over) => {
    stubEnv(over);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await (selected = null, authCalls = 0, GET(req()));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'Service unavailable' });
    expect(selected).toBeNull();
    expect(authCalls).toBe(0);
    const logged = JSON.stringify(spy.mock.calls);
    for (const s of [APPROVED_REF, OTHER_REF]) { expect(logged).not.toContain(s); expect(text).not.toContain(s); }
  });
});

describe('production go-live: the list stays admin-only on a production project', () => {
  it('the pin is lifted, the admin gate is not', async () => {
    const { checkU21ServerEnv } = await import('@/lib/u21/env-guard');
    const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const j = (p: object) => `${b({ alg: 'HS256' })}.${b(p)}.sig`;
    const ref = 'njzldypndkicpsmdtyll';
    expect(checkU21ServerEnv({
      NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: j({ role: 'service_role', ref }),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: j({ role: 'anon', ref }),
    })).toEqual({ ok: true });
    const src = (await import('fs')).readFileSync('src/app/api/u21/registrations/route.ts', 'utf8');
    expect(src).toMatch(/if \(!caller\.isSuperUser && caller\.role !== 'admin'\)/);
  });
});
