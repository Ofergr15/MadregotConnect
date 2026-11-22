import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COACH_ID } from '@/lib/constants';

/**
 * POST /api/public/signup is public and proves nothing about the address it is given.
 * A resubmission for an address that already has a request must therefore write
 * nothing: an update here let anybody rewrite another person's pending request (group,
 * name, phone, intake) — or a member record's group — by typing their email.
 * Same fake-DB harness as publicSignupMemberRecord.test.ts. Synthetic data only.
 */

type Op = {
  table: string;
  op: 'select' | 'insert' | 'update';
  row?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
};

let ops: Op[];
let rows: Record<string, Array<Record<string, unknown>>>;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const rec: Op = { table, op: 'select', filters: [] };
      const chain: Record<string, unknown> = {
        select: () => { rec.op = 'select'; ops.push(rec); return chain; },
        insert: (row: Record<string, unknown>) => {
          ops.push({ table, op: 'insert', row, filters: [] });
          return Promise.resolve({ error: null });
        },
        update: (patch: Record<string, unknown>) => {
          const u: Op = { table, op: 'update', patch, filters: [] };
          ops.push(u);
          const uchain: Record<string, unknown> = {
            eq: (col: string, val: unknown) => { u.filters.push([col, val]); return uchain; },
            then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
          };
          return uchain;
        },
        eq: (col: string, val: unknown) => { rec.filters.push([col, val]); return chain; },
        maybeSingle: () => {
          const hit = (rows[table] || []).find(r => rec.filters.every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: hit || null, error: null });
        },
      };
      return chain;
    },
  }),
}));

vi.mock('@/lib/email', () => ({
  notifyAdminNewSignupRequest: vi.fn(async () => {}),
  notifyRegistrationReceived: vi.fn(async () => {}),
}));
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: vi.fn(async () => {}) }));
vi.mock('@/lib/onboarding/events', () => ({ recordOnbEvent: vi.fn(async () => {}), deviceFromUa: () => 'test' }));

const { POST } = await import('@/app/api/public/signup/route');

let ipSeq = 0; // one client IP per call: the rate limiter is not this suite's subject
const postBody = (body: Record<string, unknown>) =>
  POST(new Request('https://example.test/api/public/signup', { method: 'POST', headers: { 'x-forwarded-for': `10.2.0.${ipSeq++ % 250}` }, body: JSON.stringify(body) }));

const VICTIM = 'victim@example.com';
const updates = () => ops.filter(o => o.table === 'signup_requests' && o.op === 'update');
const inserts = () => ops.filter(o => o.table === 'signup_requests' && o.op === 'insert');

beforeEach(() => {
  ops = [];
  rows = { athletes: [], signup_requests: [], groups: [] };
});

describe('POST /api/public/signup never rewrites an existing request', () => {
  it("an anonymous resubmit cannot change a pending request's group, name, phone or intake", async () => {
    rows.signup_requests = [{ id: 'req-p', email: VICTIM, status: 'pending' }];
    rows.groups = [{ id: 'g-other', name: 'דבוקה 3', coach_id: COACH_ID }];
    const res = await postBody({
      email: VICTIM, groupId: 'g-other', fullName: 'Attacker Name',
      phone: '0500000000', intake: { goal: 'overwritten' },
    });
    expect(await res.json()).toEqual({ ok: true, state: 'pending' });
    expect(updates()).toHaveLength(0);
    expect(inserts()).toHaveLength(0);
  });

  it("an anonymous resubmit cannot change an existing member record's group", async () => {
    rows.athletes = [{ id: 'ath-1', email: VICTIM }];
    rows.signup_requests = [{ id: 'req-m', email: VICTIM, status: 'member' }];
    rows.groups = [{ id: 'g-other', name: 'דבוקה 3', coach_id: COACH_ID }];
    const res = await postBody({ email: VICTIM, groupId: 'g-other' });
    expect(await res.json()).toEqual({ ok: true, state: 'member' });
    expect(updates()).toHaveLength(0);
  });

  it('a new address is still recorded (the fix does not stop sign-ups)', async () => {
    const res = await postBody({ email: 'new@example.com', fullName: 'New Person', phone: '0501234567' });
    expect(await res.json()).toEqual({ ok: true, state: 'new' });
    expect(inserts()).toHaveLength(1);
  });
});
