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
const received = vi.fn();
const recordCard = vi.fn();

vi.mock('@/lib/email', () => ({
  notifyAdminNewAcademyRegistration: (u: unknown) => notify(u),
  notifyAcademyFormReceived: (u: unknown) => received(u),
}));
// The funnel card is its own module with its own tests (academyIntake.test.ts); here it
// only matters WHICH athlete the route hands it.
vi.mock('@/lib/academy/intake-server', () => ({
  recordFormCandidate: (_s: unknown, p: unknown) => { recordCard(p); return Promise.resolve('cand-1'); },
  invitePrefill: () => Promise.resolve(null),
}));
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
          record.op = 'insert'; record.patch = patch; ops.push(record); return chain;
        },
        single: () => Promise.resolve({ data: { id: 'new-1' }, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));

const { POST } = await import('@/app/api/academy/register/route');

// A fresh address per call unless one is given: the route rate-limits per IP, and these
// cases are not about that.
let ipSeq = 0;
const post = (payload: Record<string, unknown>, ip = `10.0.0.${++ipSeq}`) =>
  POST(new Request('https://example.test/api/academy/register', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: JSON.stringify({ name: 'Daniel Levi', email: 'Daniel@Example.com', phone: '0500000000', ...payload }),
  }));

const athleteWrites = () => ops.filter(o => o.table === 'athletes' && (o.op === 'update' || o.op === 'insert'));

beforeEach(() => { ops = []; existing = null; notify.mockReset(); received.mockReset(); recordCard.mockReset(); });

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
    expect(athleteWrites()).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ existingMember: true, email: 'daniel@example.com' }));
  });

  it('never demotes a coach whose address is typed into the form', async () => {
    existing = { id: 'c1', approved: true, invite_token: null, onboarding_status: null };
    await post({ name: 'Somebody Else' });
    expect(ops.some(o => o.patch && ('role' in o.patch || 'approved' in o.patch || 'name' in o.patch))).toBe(false);
  });
});

describe('the academy door during maintenance', () => {
  it('stays open, like /register', async () => {
    // The Instagram auto-reply links here; behind the gate a lead meets "we're rebuilding"
    // and is lost silently. isPublicPath is module-private, so this reads its list.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/lib/public-paths.ts', 'utf8');
    const list = /const PUBLIC_PATHS = \[([^\]]*)\]/.exec(src)?.[1] ?? '';
    expect(list).toContain("'/academy-register'");
    expect(list).toContain("'/join'");
  });

  it('puts a new applicant on the funnel, linked to the row it just made, and tells them it arrived', async () => {
    await post({ inviteToken: 'a'.repeat(32), src: 'ig' });
    expect(recordCard).toHaveBeenCalledWith(expect.objectContaining({
      athleteId: 'new-1', email: 'daniel@example.com', inviteToken: 'a'.repeat(32), src: 'ig',
    }));
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ email: 'daniel@example.com', candidateId: 'cand-1' }));
  });

  it('gives an existing member a card but never links it to their account', async () => {
    existing = { id: 'm1', approved: true, invite_token: 'tok-m', onboarding_status: 'complete' };
    await post({});
    expect(recordCard).toHaveBeenCalledWith(expect.objectContaining({ athleteId: null }));
  });

  it('answers a filled honeypot like a success and writes nothing', async () => {
    const res = await post({ website: 'http://spam.example' });
    expect(await res.json()).toEqual({ success: true });
    expect(ops.filter(o => o.op !== 'select')).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
    expect(received).not.toHaveBeenCalled();
  });

  it('turns away the sixth submit in a minute from one address', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post({}, '192.0.2.9')).status);
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes[5]).toBe(429);
  });
});
