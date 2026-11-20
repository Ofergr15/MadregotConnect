import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/auth/email-code must not tell a member's address from a stranger's.
 *
 * Before: `send` returned {ok:true} for a non-member before any limit, while a member's
 * 4th send in 15 minutes got 429 — and `verify` said 'expired' with no code row but
 * 'wrong-code' + `left` with one. Here a member and a non-member get the same 4 sends and
 * the same wrong verify, and every status and body must be byte-identical. The member work
 * runs in after(), which the harness collects and drains, so the response is shown not to
 * wait on it (timing) and a database fault there to be logged, not answered.
 * Synthetic data only; the DB is an in-memory fake.
 */

// after() callbacks are held, not started, until drain(): what the response contains
// cannot depend on work that has not run yet.
const deferred: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (fn: () => unknown) => { deferred.push(fn); },
}));
const drain = async () => { while (deferred.length) await deferred.shift()!(); };
let failDb = false;
let dbDelayMs = 0;
const reads: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MEMBER = 'member@example.com';
const STRANGER = 'stranger@example.com';
let codes: Array<{ id: string; email: string; code_hash: string; expires_at: string; attempts: number; created_at: string }>;
const hashed: string[] = [];
const mailed = vi.fn(async () => ({ ok: true }));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      if (failDb) throw new Error('relation "login_codes" connection reset');
      const eqs: Record<string, unknown> = {};
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let head = false;
      let payload: any = null;
      const rowsFor = () => codes.filter((c) => Object.entries(eqs).every(([k, v]) => (c as any)[k] === v));
      const chain: any = {
        select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) head = true; return chain; },
        insert: (p: any) => { op = 'insert'; payload = p; return chain; },
        update: (p: any) => { op = 'update'; payload = p; return chain; },
        delete: () => { op = 'delete'; return chain; },
        eq: (c: string, v: unknown) => { eqs[c] = v; return chain; },
        lt: () => chain, gte: () => chain, not: () => chain, order: () => chain, limit: () => chain,
        maybeSingle: async () => {
          reads.push(table);
          if (dbDelayMs) await sleep(dbDelayMs);
          if (table === 'athletes') {
            return { data: eqs.email === MEMBER ? { id: 'a1', email: MEMBER, name: 'M', approved: true, status: 'active' } : null, error: null };
          }
          if (table === 'login_codes') return { data: rowsFor().at(-1) ?? null, error: null };
          return { data: null, error: null };
        },
        then: (res: (v: unknown) => unknown) => {
          if (head) reads.push(`${table}:count`);
          if (table !== 'login_codes') return Promise.resolve({ data: null, error: null }).then(res);
          if (op === 'insert') {
            codes.push({ id: `c${codes.length}`, attempts: 0, created_at: new Date().toISOString(), ...payload });
            return Promise.resolve({ error: null }).then(res);
          }
          if (op === 'update') { const r = rowsFor(); r.forEach((x) => Object.assign(x, payload)); return Promise.resolve({ data: r.map((x) => ({ id: x.id })), error: null }).then(res); }
          if (op === 'delete') { codes = codes.filter((c) => !rowsFor().includes(c)); return Promise.resolve({ error: null }).then(res); }
          if (head) return Promise.resolve({ count: rowsFor().length, error: null }).then(res);
          return Promise.resolve({ data: rowsFor(), error: null }).then(res);
        },
      };
      return chain;
    },
  }),
}));
vi.mock('@/lib/email', () => ({ notifyLoginCode: (...a: unknown[]) => mailed(...(a as [])) }));
vi.mock('@/lib/onboarding/events', () => ({ recordOnbEvent: vi.fn(), deviceFromUa: () => 'test' }));
vi.mock('@/lib/auth/synthetic-session', () => ({ createSyntheticSession: vi.fn() }));
vi.mock('@/lib/auth/email-code', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/email-code')>()),
  hashCode: (...a: unknown[]) => { hashed.push(String(a[0])); return 'h'; }, codeMatches: () => false,
}));

import { POST } from '@/app/api/auth/email-code/route';

const call = (ip: string, body: Record<string, unknown>) => POST(new Request('http://x/api/auth/email-code', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body),
}));

async function probe(email: string, ip: string) {
  const out: Array<[number, string]> = [];
  for (let n = 0; n < 4; n++) {
    const r = await call(ip, { action: 'send', email });
    out.push([r.status, await r.text()]);
    await drain(); // the member's code row lands before the next send, as it would in production
  }
  const v = await call(ip, { action: 'verify', email, code: '123456' });
  out.push([v.status, await v.text()]);
  return out;
}

beforeEach(() => { codes = []; mailed.mockClear(); deferred.length = 0; failDb = false; dbDelayMs = 0; reads.length = 0; hashed.length = 0; });

describe('email-code is not a membership oracle', () => {
  it('4 sends + a wrong verify: identical status and body for a member and a non-member', async () => {
    const member = await probe(MEMBER, '198.51.100.1');
    const stranger = await probe(STRANGER, '198.51.100.2');
    expect(member).toEqual(stranger);
    expect(member.slice(0, 4).every(([s]) => s === 200)).toBe(true);
    expect(member[4]).toEqual([401, JSON.stringify({ error: 'wrong-code' })]);
  });

  it('a member past the per-address cap gets no further code mail', async () => {
    await probe(MEMBER, '198.51.100.3');
    expect(mailed).toHaveBeenCalledTimes(3); // MAX_SENDS; the 4th answered ok and mailed nobody
  });

  it('the rate limit runs before membership: the 6th send in a minute is 429 for both', async () => {
    for (const [email, ip] of [[MEMBER, '198.51.100.4'], [STRANGER, '198.51.100.5']]) {
      for (let n = 0; n < 5; n++) expect((await call(ip, { action: 'send', email })).status).toBe(200);
      const sixth = await call(ip, { action: 'send', email });
      expect([sixth.status, await sixth.text()]).toEqual([429, JSON.stringify({ error: 'too-many' })]);
    }
  });

  it('the response does not wait for the member work: nothing has run when it returns', async () => {
    const r = await call('198.51.100.6', { action: 'send', email: MEMBER });
    expect([r.status, await r.text()]).toEqual([200, JSON.stringify({ ok: true })]);
    expect(codes).toEqual([]);           // no code row yet
    expect(mailed).not.toHaveBeenCalled();
    await drain();
    expect(codes).toHaveLength(1);
    expect(mailed).toHaveBeenCalledTimes(1);
  });

  it('a database exception during send still answers 200 {ok:true} and is logged', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    failDb = true;
    const r = await call('198.51.100.7', { action: 'send', email: MEMBER });
    expect([r.status, await r.text()]).toEqual([200, JSON.stringify({ ok: true })]);
    await drain();
    expect(logged).toHaveBeenCalledWith('[email-code] send failed:', expect.any(Error));
    logged.mockRestore();
  });

  it('timing: with slow DB reads (60 ms each), member and non-member responses are equally fast (within 20 ms)', async () => {
    dbDelayMs = 60;
    const time = async (email: string, ip: string) => {
      const t0 = performance.now();
      const r = await call(ip, { action: 'send', email });
      await r.text();
      return performance.now() - t0;
    };
    const m: number[] = [], s: number[] = [];
    for (let n = 0; n < 3; n++) {
      m.push(await time(MEMBER, `198.51.101.${n}`));
      s.push(await time(STRANGER, `198.51.102.${n}`));
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[1];
    // The response waits on no DB read for either address, so both stay well under one read.
    expect(Math.max(...m, ...s)).toBeLessThan(dbDelayMs);
    expect(Math.abs(median(m) - median(s))).toBeLessThan(20);
    deferred.length = 0;
  });

  it('the deferred work has the same shape for both: same reads, a code hashed for each', async () => {
    const shape = async (email: string, ip: string) => {
      reads.length = 0; hashed.length = 0;
      await call(ip, { action: 'send', email });
      await drain();
      return { reads: [...reads], hashed: hashed.length };
    };
    const stranger = await shape(STRANGER, '198.51.103.1');
    const member = await shape(MEMBER, '198.51.103.2');
    expect(stranger).toEqual({ reads: ['athletes', 'login_codes:count'], hashed: 1 });
    expect(member).toEqual(stranger); // a member additionally inserts and mails, after these
  });
});
