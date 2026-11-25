import { beforeEach, describe, expect, it, vi } from 'vitest';

// signups_open defaults off (lib/signups/open); these tests exercise the route with the door open.
vi.mock('@/lib/signups/open', () => ({ signupsOpen: async () => true, SIGNUPS_CLOSED_BODY: { error: 'signups-closed' } }));

/**
 * CONTRACT for the native academy form client: POST /api/academy/register.
 * Pins the body the route reads, which parts it validates (only name and email — the
 * intake is stored as sent), every response shape, and what a repeated submit does.
 * See docs/contracts/academy-register.md.
 */

type Op = { table: string; op: 'select' | 'insert' | 'update'; patch?: Record<string, unknown> };
let ops: Op[] = [];
let existingAthlete: Record<string, unknown> | null = null;
let registrationSetting: string | null = null;
const mails = { admin: vi.fn(), received: vi.fn(), push: vi.fn() };

vi.mock('@/lib/email', () => ({
  notifyAdminNewAcademyRegistration: (x: unknown) => mails.admin(x),
  notifyAcademyFormReceived: (x: unknown) => mails.received(x),
}));
vi.mock('@/lib/notifications/staff', () => ({
  notifyStaff: async (x: unknown) => { mails.push(x); return { recipients: 1, sent: 1 }; },
  academyManagerIds: async () => [],
}));
vi.mock('@/lib/academy/intake-server', () => ({ recordFormCandidate: async () => 'cand-1', invitePrefill: async () => null }));
vi.mock('@/lib/academy/link-server', () => ({ likelyClubMember: async () => null }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const rec: Op = { table, op: 'select' };
      const result = () => {
        if (table === 'app_settings') return { data: registrationSetting ? { value: registrationSetting } : null, error: null };
        if (table === 'athletes' && rec.op === 'select') return { data: existingAthlete, error: null };
        if (table === 'academy_candidates' && rec.op === 'update') return { data: [{ id: 'cand-1' }], error: null }; // mail claim won
        if (table === 'academy_candidates') return { data: null, error: null };
        return { data: { id: 'new-1' }, error: null };
      };
      const c: any = {
        select: () => c, eq: () => c, or: () => c, gte: () => c, limit: () => c,
        update: (p: Record<string, unknown>) => { rec.op = 'update'; rec.patch = p; ops.push(rec); return c; },
        insert: (p: Record<string, unknown>) => { rec.op = 'insert'; rec.patch = p; ops.push(rec); return c; },
        maybeSingle: async () => result(), single: async () => result(),
        then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
      };
      return c;
    },
  }),
}));

const { POST } = await import('@/app/api/academy/register/route');

// Answers the web form puts in `intake` (name/email/phone travel at the top level). The form defines 22 fields; which appear depends on earlier answers.
const INTAKE = {
  firstName: 'Daniel', lastName: 'Levi', focus: 'x', birthDate: '1990-05-01', city: 'תל אביב', group: 'x', height: '178', weight: '70',
  runningHistory: '30 ק״מ בשבוע', achievements: '', medicalHistory: 'x', hearAbout: 'x', shirtSize: 'M', pantsSize: 'M',
  tightsSize: 'M', shoeSize: '43', gender: 'x',
};
let ip = 0;
const send = (over: Record<string, unknown> = {}, from = `10.1.${++ip}.1`) => POST(new Request('https://x/api/academy/register', {
  method: 'POST', headers: { 'x-forwarded-for': from },
  body: JSON.stringify({ name: 'Daniel Levi', email: ' Daniel@Example.com ', phone: '0501234567', intake: INTAKE, ...over }),
}));
const athleteWrites = () => ops.filter((o) => o.table === 'athletes' && o.op !== 'select');

beforeEach(() => {
  ops = []; existingAthlete = null; registrationSetting = null;
  mails.admin.mockReset(); mails.received.mockReset(); mails.push.mockReset();
});

describe('success → 200 { success: true } (plus letIn / alreadyIn only when they apply)', () => {
  it('a new applicant: one pending academy athlete row, intake stored as sent, mails + staff push', async () => {
    const res = await send();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    const [w] = athleteWrites();
    expect(w.op).toBe('insert');
    expect(w.patch).toMatchObject({
      name: 'Daniel Levi', email: 'daniel@example.com', phone: '0501234567', status: 'invited', is_academy: true,
      role: 'academy_user', approved: false, onboarding_status: 'academy_pending', academy_intake: INTAKE,
    });
    expect(w.patch!.invite_token).toMatch(/^[0-9a-f]{32}$/);
    expect([mails.admin, mails.received, mails.push].map((m) => m.mock.calls.length)).toEqual([1, 1, 1]);
  });
  it('the intake is NOT validated server-side: unknown keys, wrong types and missing "required" answers are all stored', async () => {
    const odd = { shoeSize: 99, extra: { nested: true } };
    expect((await send({ intake: odd })).status).toBe(200);
    expect(athleteWrites()[0].patch!.academy_intake).toEqual(odd);
  });
  it('phone is optional; a non-object intake is stored as null', async () => {
    expect((await send({ phone: undefined, intake: 'nope' })).status).toBe(200);
    expect(athleteWrites()[0].patch).toMatchObject({ phone: null, academy_intake: null });
  });
  it('an address that already belongs to a member: same 200, their row untouched (no roster disclosure)', async () => {
    existingAthlete = { id: 'm1', approved: true, onboarding_status: 'active', invite_token: null };
    expect(await (await send()).json()).toEqual({ success: true });
    expect(athleteWrites()).toEqual([]);
  });
});

describe('errors', () => {
  it.each([
    ['no name', { name: '' }], ['blank name', { name: '   ' }], ['no email', { email: undefined }],
  ])('%s → 400 { error: "Name and email are required" }', async (_l, over) => {
    const res = await send(over);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Name and email are required' });
    expect(athleteWrites()).toEqual([]);
  });
  it('a name with no letters → 400 { error, code: "no-letters" }', async () => {
    expect(await (await send({ name: '1234 !!' })).json()).toEqual({ error: 'Please write your name', code: 'no-letters' });
  });
  it('email is not format-checked server-side', async () => {
    expect((await send({ email: 'not-an-email' })).status).toBe(200);
  });
  it('registration closed (no invite) → 403 { error, message (Hebrew) }', async () => {
    registrationSetting = 'closed';
    const res = await send();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Academy registration is currently closed.', message: 'ההרשמה לאקדמיה סגורה כרגע.' });
  });
  it('honeypot `website` filled → 200 { success: true }, nothing written or mailed', async () => {
    expect(await (await send({ website: 'x' })).json()).toEqual({ success: true });
    expect(athleteWrites()).toEqual([]);
    expect(mails.admin).not.toHaveBeenCalled();
  });
  it('6th submit in a minute for one IP+email → 429 { error }', async () => {
    const from = '10.9.9.9';
    for (let i = 0; i < 5; i++) await send({}, from);
    const res = await send({}, from);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'Too many attempts, try again in a minute' });
  });
  it('the same IP with a different email is not limited by the first person', async () => {
    const from = '10.8.8.8';
    for (let i = 0; i < 5; i++) await send({}, from);
    expect((await send({ email: 'other@example.com' }, from)).status).toBe(200);
  });
});

describe('double submit', () => {
  it('a second submit of a still-pending application UPDATES the same row and keeps its invite token', async () => {
    existingAthlete = { id: 'p1', approved: false, onboarding_status: 'academy_pending', invite_token: 'a'.repeat(32), academy_intake: null };
    expect(await (await send()).json()).toEqual({ success: true });
    const [w] = athleteWrites();
    expect(w.op).toBe('update');
    expect(w.patch!.invite_token).toBe('a'.repeat(32));
    expect(ops.some((o) => o.table === 'athletes' && o.op === 'insert')).toBe(false);
  });
  it('once accepted (approved), a resubmit only refreshes name/phone/intake — approval untouched', async () => {
    existingAthlete = { id: 'p1', approved: true, onboarding_status: 'academy_pending', invite_token: 't', academy_intake: {} };
    expect(await (await send()).json()).toEqual({ success: true });
    const [w] = athleteWrites();
    expect(Object.keys(w.patch!).sort()).toEqual(['academy_intake', 'name', 'phone']);
    expect(mails.admin).not.toHaveBeenCalled();
  });
});
