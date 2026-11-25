import { beforeEach, describe, expect, it, vi } from 'vitest';

// signups_open defaults off (lib/signups/open); these tests exercise the route with the door open.
vi.mock('@/lib/signups/open', () => ({ signupsOpen: async () => true, SIGNUPS_CLOSED_BODY: { error: 'signups-closed' } }));

/**
 * POST /api/public/signup is public and every accepted submission writes a row and mails
 * the approver, staff and the typed address. Five a minute per person (ip|email), forty
 * per IP; the 6th answers 429 BEFORE any database read or write and before any mail.
 * Same fake-DB harness as publicSignupNoOverwrite.test.ts. Synthetic data only.
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

const mail = vi.hoisted(() => ({ admin: vi.fn(async () => {}), received: vi.fn(async () => {}) }));
vi.mock('@/lib/email', () => ({
  notifyAdminNewSignupRequest: mail.admin,
  notifyRegistrationReceived: mail.received,
}));
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: vi.fn(async () => {}) }));
vi.mock('@/lib/onboarding/events', () => ({ recordOnbEvent: vi.fn(async () => {}), deviceFromUa: () => 'test' }));

const { POST } = await import('@/app/api/public/signup/route');

const postBody = (body: Record<string, unknown>, ip = '203.0.113.7') =>
  POST(new Request('https://example.test/api/public/signup', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify(body) }));


beforeEach(() => {
  ops = [];
  rows = { athletes: [], signup_requests: [], groups: [] };
});

describe('POST /api/public/signup is rate limited', () => {
  it('the 6th submission within a minute gets 429, with no database access and no mail', async () => {
    for (let n = 0; n < 5; n++) {
      const r = await postBody({ email: 'flood@example.com' });
      expect(r.status).not.toBe(429);
    }
    ops = [];
    mail.admin.mockClear(); mail.received.mockClear();
    const sixth = await postBody({ email: 'flood@example.com' });
    expect(sixth.status).toBe(429);
    expect(ops).toEqual([]);
    expect(mail.admin).not.toHaveBeenCalled();
    expect(mail.received).not.toHaveBeenCalled();
  });

  it('another person on the same Wi-Fi is not blocked by the first one', async () => {
    const r = await postBody({ email: 'neighbour@example.com' });
    expect(r.status).not.toBe(429);
  });
});
