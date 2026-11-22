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


let inserted: Record<string, unknown>[] = [];
let u21FlagOn = true; // the club-wide u21_entry switch (lib/u21/flag)
vi.mock('@/lib/u21/flag', () => ({ u21EntryOn: async () => u21FlagOn }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => { inserted.push({ table, ...row }); return Promise.resolve({ error: null }); },
    }),
  }),
}));

import { POST } from '@/app/api/u21/register/route';

const base = {
  firstName: 'נועה', lastName: 'כהן', email: 'A@Example.com', phone: '0501234567', birthDate: '2007-01-01',
  framework: 'מכינה קדם־צבאית', goal: 'גיבוש', experience: 'אין ניסיון', runsPerWeek: '0', strengthExperience: 'אין',
  availableDays: ['שני'], sleepHours: '6–7', chestPain: 'no', fainting: 'no', bonePain: 'no', acuteInjury: 'no',
};
const req = (body: unknown, ip = '1.1.1.1') => new Request('http://x/api/u21/register', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body),
});

describe('POST /api/u21/register', () => {
  beforeEach(() => { inserted = []; });

  it('stores pending_review and answers identically whether or not a draft red flag is set', async () => {
    const a = await POST(req({ track: 'basic', answers: base }, '2.2.2.1'));
    const b = await POST(req({ track: 'pro', answers: { ...base, fainting: 'yes' } }, '2.2.2.2'));
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
    expect(inserted.map(r => [r.status, r.red_flag, r.flag_fainting])).toEqual([
      ['pending_review', false, false], ['pending_review', true, true],
    ]);
    expect(inserted[0].email).toBe('a@example.com');
  });

  it('400s an invalid intake and stores nothing', async () => {
    const res = await POST(req({ track: 'basic', answers: { ...base, birthDate: '2009-01-01' } }, '2.2.2.3'));
    expect(res.status).toBe(400);
    expect((await res.json()).errors.guardianName).toBeDefined();
    expect(inserted).toEqual([]);
  });

  it('400s malformed required values (true for name/email/phone) and stores nothing', async () => {
    const res = await POST(req({ track: 'basic', answers: { ...base, firstName: true, email: true, phone: true } }, '2.2.2.5'));
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).errors).sort()).toEqual(['email', 'firstName', 'phone']);
    expect(inserted).toEqual([]);
  });

  it.each([['an array', [base]], ['a string', 'x'], ['null', null], ['missing', undefined]])('400s answers that are %s', async (_l, answers) => {
    const res = await POST(req({ track: 'basic', answers }, '2.2.2.6'));
    expect(res.status).toBe(400);
    expect(inserted).toEqual([]);
  });

  it('400s a body that is an array', async () => {
    expect((await POST(req([{ track: 'basic', answers: base }], '2.2.2.7'))).status).toBe(400);
  });

  it('a honeypot submit is acknowledged and not stored', async () => {
    const res = await POST(req({ track: 'basic', answers: base, website: 'spam' }, '2.2.2.4'));
    expect(res.status).toBe(200);
    expect(inserted).toEqual([]);
  });
});

describe('POST /api/u21/register — error redaction', () => {
  it('never returns the DB error message', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase/server', () => ({
      createServerClient: () => ({
        from: () => ({ insert: () => Promise.resolve({ error: { message: 'violates check constraint "u21_guardian_for_minors" on u21_registrations', code: '23514' } }) }),
      }),
    }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST: post } = await import('@/app/api/u21/register/route');
    const res = await post(req({ track: 'basic', answers: base }, '3.3.3.1'));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'Could not save' });
    expect(text).not.toMatch(/u21_|constraint|23514/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    vi.doUnmock('@/lib/supabase/server');
  });

  it('never returns a thrown exception message', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase/server', () => ({
      createServerClient: () => { throw new Error('SUPABASE_SERVICE_ROLE_KEY missing at /var/secret'); },
    }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST: post } = await import('@/app/api/u21/register/route');
    const res = await post(req({ track: 'basic', answers: base }, '3.3.3.2'));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'Server error' });
    expect(text).not.toMatch(/SUPABASE|secret/);
    spy.mockRestore();
    vi.doUnmock('@/lib/supabase/server');
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
    const res = await POST(req({ track: 'basic', answers: base }, '4.4.4.' + Math.random()));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'Service unavailable' });
    expect(inserted).toEqual([]);
    const logged = JSON.stringify(spy.mock.calls);
    for (const s of [APPROVED_REF, OTHER_REF]) { expect(logged).not.toContain(s); expect(text).not.toContain(s); }
  });
});

describe('production go-live (2026-11-22)', () => {
  const PROD_REF = 'njzldypndkicpsmdtyll';
  afterEach(() => { stubEnv(); u21FlagOn = true; inserted = []; });
  it('a self-consistent production project stores the registration (pin lifted)', async () => {
    stubEnv({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role', ref: PROD_REF }),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon', ref: PROD_REF }),
    });
    inserted = [];
    const res = await POST(req({ track: 'basic', answers: base }, '5.5.5.' + Math.random()));
    expect(res.status).toBe(200);
    expect(inserted).toHaveLength(1);
  });
  it('u21_entry off → 404, nothing stored', async () => {
    u21FlagOn = false;
    inserted = [];
    const res = await POST(req({ track: 'basic', answers: base }, '5.5.6.' + Math.random()));
    expect(res.status).toBe(404);
    expect(inserted).toEqual([]);
  });
});
