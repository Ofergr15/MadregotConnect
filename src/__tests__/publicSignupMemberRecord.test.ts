import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * POST /api/public/signup, the third of its three outcomes: the submitter already
 * has an account.
 *
 * That case used to write nothing. It was reasoned as "nothing to queue", which is
 * true of the queue and false of the record — the person was told, correctly, that
 * their address is already registered, and then did not appear anywhere in
 * /dashboard/registrations, so the coach could not see they had answered the link
 * at all. Ofer hit it with his own friends on 2026-09-06.
 *
 * What these pin is the shape of the record, not just its existence: status
 * 'member', linked to the account they already have, no approver stamped on it, and
 * nobody emailed. Getting any of those wrong turns a note into a fake approval.
 */

type Op = {
  table: string;
  op: 'select' | 'insert' | 'update';
  row?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
};

let ops: Op[];
/** Rows the fake DB will answer with, per table, matched on the eq() filters. */
let rows: Record<string, Array<Record<string, unknown>>>;
/** Forced failure from the signup_requests insert, to test the swallow path. */
let insertError: { code: string } | null;
let mailed: number;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const rec: Op = { table, op: 'select', filters: [] };
      const chain: Record<string, unknown> = {
        select: () => { rec.op = 'select'; ops.push(rec); return chain; },
        insert: (row: Record<string, unknown>) => {
          ops.push({ table, op: 'insert', row, filters: [] });
          return Promise.resolve({ error: table === 'signup_requests' ? insertError : null });
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
  notifyAdminNewSignupRequest: vi.fn(async () => { mailed += 1; }),
}));

const { POST } = await import('@/app/api/public/signup/route');

const post = (email: string, groupId?: string) =>
  POST(new Request('https://example.test/api/public/signup', {
    method: 'POST',
    body: JSON.stringify({ email, groupId }),
  }));

const MEMBER = 'dana@gmail.com';
const ATHLETE_ID = 'athlete-1';

beforeEach(() => {
  ops = [];
  insertError = null;
  mailed = 0;
  rows = { athletes: [{ email: MEMBER, id: ATHLETE_ID }], signup_requests: [], groups: [] };
});

const inserts = () => ops.filter(o => o.op === 'insert' && o.table === 'signup_requests');

describe('POST /api/public/signup — an existing member submits the form', () => {
  it('records the submission instead of dropping it', async () => {
    const res = await post(MEMBER);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, state: 'member' });
    expect(inserts()).toHaveLength(1);
  });

  it('writes it as a record, not as an approval', async () => {
    await post(MEMBER);
    const row = inserts()[0].row!;
    expect(row.status).toBe('member');
    expect(row.email).toBe(MEMBER);
    // The account they already have, so the admin row points at a person.
    expect(row.athlete_id).toBe(ATHLETE_ID);
    // ⚠️ The whole point of a separate status: nobody approved this. An approver
    // stamp here would put a fake entry in the audit trail.
    expect(row.approved_at).toBeUndefined();
    expect(row.approved_by).toBeUndefined();
  });

  it('does not email the approvers — there is nothing for them to do', async () => {
    await post(MEMBER);
    expect(mailed).toBe(0);
  });

  it('is idempotent: a second visit updates, never inserts a twin', async () => {
    rows.signup_requests = [{ email: MEMBER, status: 'member', id: 'req-1' }];
    rows.groups = [{ id: 'g1', name: 'דבוקה 1', coach_id: undefined }];
    const res = await post(MEMBER);
    expect(await res.json()).toEqual({ ok: true, state: 'member' });
    expect(inserts()).toHaveLength(0);
  });

  it('still answers the person if the record cannot be written', async () => {
    // Migration 089 is applied by hand, so until it is pasted in, the status CHECK
    // rejects 'member' (23514). The submitter IS a member and must be told so; this
    // is bookkeeping hung off an answer that is already correct.
    insertError = { code: '23514' };
    const res = await post(MEMBER);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, state: 'member' });
  });

  it('says "waiting for approval" when the member is already in the queue', async () => {
    // The pre-launch backfill (migration 090) puts every existing member in the
    // queue as pending, so from then on a club member matches BOTH branches. The
    // queue branch has to win: there IS something waiting to happen to them — the
    // approval that mails their onboarding link — and "אין צורך להירשם שוב" would
    // be literally true and actively misleading.
    rows.signup_requests = [{ email: MEMBER, status: 'pending', id: 'req-1' }];
    const res = await post(MEMBER);
    expect(await res.json()).toEqual({ ok: true, state: 'pending' });
    expect(inserts()).toHaveLength(0);
    // And no second mail to the approvers: they already know about this one.
    expect(mailed).toBe(0);
  });

  it('leaves the other two outcomes alone', async () => {
    // A stranger: still queued as pending, and the approvers still hear about it.
    const res = await post('stranger@gmail.com');
    expect(await res.json()).toEqual({ ok: true, state: 'new' });
    expect(inserts()[0].row!.status).toBe('pending');
    expect(mailed).toBe(1);
  });
});
