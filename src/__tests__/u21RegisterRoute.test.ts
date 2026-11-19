import { beforeEach, describe, expect, it, vi } from 'vitest';

let inserted: Record<string, unknown>[] = [];
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
