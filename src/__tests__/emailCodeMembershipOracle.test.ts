import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/auth/email-code must not tell a member's address from a stranger's.
 *
 * Before: `send` returned {ok:true} for a non-member before any limit, while a member's
 * 4th send in 15 minutes got 429 — and `verify` said 'expired' with no code row but
 * 'wrong-code' + `left` with one. Here a member and a non-member get the same 4 sends and
 * the same wrong verify, and every status and body must be byte-identical.
 * Synthetic data only; the DB is an in-memory fake.
 */

const MEMBER = 'member@example.com';
const STRANGER = 'stranger@example.com';
let codes: Array<{ id: string; email: string; code_hash: string; expires_at: string; attempts: number; created_at: string }>;
const mailed = vi.fn(async () => ({ ok: true }));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
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
          if (table === 'athletes') {
            return { data: eqs.email === MEMBER ? { id: 'a1', email: MEMBER, name: 'M', approved: true, status: 'active' } : null, error: null };
          }
          if (table === 'login_codes') return { data: rowsFor().at(-1) ?? null, error: null };
          return { data: null, error: null };
        },
        then: (res: (v: unknown) => unknown) => {
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
  hashCode: () => 'h', codeMatches: () => false,
}));

import { POST } from '@/app/api/auth/email-code/route';

const call = (ip: string, body: Record<string, unknown>) => POST(new Request('http://x/api/auth/email-code', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body),
}));

async function probe(email: string, ip: string) {
  const out: Array<[number, string]> = [];
  for (let n = 0; n < 4; n++) { const r = await call(ip, { action: 'send', email }); out.push([r.status, await r.text()]); }
  const v = await call(ip, { action: 'verify', email, code: '123456' });
  out.push([v.status, await v.text()]);
  return out;
}

beforeEach(() => { codes = []; mailed.mockClear(); });

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
});
