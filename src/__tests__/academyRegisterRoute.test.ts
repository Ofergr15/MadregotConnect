import { describe, expect, it, vi, beforeEach } from 'vitest';

// POST /api/academy/register is public and unauthenticated — it is the academy's front door.
// It used to rewrite ANY existing row whose email matched with approved:false, role
// 'academy_user' and status 'invited', so typing a club member's address into the form logged
// them out to the waiting room, and typing a coach's stripped the role that grants staff access.
// These tests pin what it may touch: new rows, and rows that are themselves a pending academy
// application. Nothing else.

type Op = { table: string; op: string; patch?: Record<string, unknown> };
let ops: Op[];
let existing: Record<string, unknown> | null;
const notify = vi.fn();

vi.mock('@/lib/email', () => ({ notifyAdminNewAcademyRegistration: (u: unknown) => notify(u) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const record: Op = { table, op: 'select' };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: existing, error: null }),
        update: (patch: Record<string, unknown>) => {
          record.op = 'update'; record.patch = patch; ops.push(record); return chain;
        },
        insert: (patch: Record<string, unknown>) => {
          record.op = 'insert'; record.patch = patch; ops.push(record); return Promise.resolve({ error: null });
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));

const { POST } = await import('@/app/api/academy/register/route');

const post = (payload: Record<string, unknown>) =>
  POST(new Request('https://example.test/api/academy/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Daniel Levi', email: 'Daniel@Example.com', phone: '0500000000', ...payload }),
  }));

beforeEach(() => { ops = []; existing = null; notify.mockReset(); });

describe('POST /api/academy/register', () => {
  it('creates a new applicant as a pending academy row', async () => {
    const res = await post({});
    expect(await res.json()).toEqual({ success: true });
    const insert = ops.find(o => o.op === 'insert');
    expect(insert?.patch).toMatchObject({
      email: 'daniel@example.com', approved: false, is_academy: true, onboarding_status: 'academy_pending',
    });
    expect(notify).toHaveBeenCalledWith(expect.not.objectContaining({ existingMember: true }));
  });

  it('lets a pending applicant re-submit, keeping their invite token', async () => {
    existing = { id: 'p1', approved: false, invite_token: 'tok-1', onboarding_status: 'academy_pending' };
    await post({});
    const update = ops.find(o => o.op === 'update');
    expect(update?.patch).toMatchObject({ invite_token: 'tok-1', onboarding_status: 'academy_pending' });
  });

  it('leaves an approved club member exactly as they are', async () => {
    existing = { id: 'm1', approved: true, invite_token: 'tok-m', onboarding_status: 'complete' };
    const res = await post({});
    // Same answer as a new sign-up: the public form must not reveal who is on the roster.
    expect(await res.json()).toEqual({ success: true });
    expect(ops.filter(o => o.op === 'update' || o.op === 'insert')).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ existingMember: true, email: 'daniel@example.com' }));
  });

  it('never demotes a coach whose address is typed into the form', async () => {
    existing = { id: 'c1', approved: true, invite_token: null, onboarding_status: null };
    await post({ name: 'Somebody Else' });
    expect(ops.some(o => o.patch && ('role' in o.patch || 'approved' in o.patch || 'name' in o.patch))).toBe(false);
  });
});
