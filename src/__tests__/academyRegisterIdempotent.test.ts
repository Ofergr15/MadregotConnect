import { describe, expect, it, vi, beforeEach } from 'vitest';

// 2026-11-18: an imported trainee, accepted at 18:06, got two "academy_form_received" mails and
// staff two heads-ups (18:14, 18:15). A repeat submit inside FORM_RESEND_WINDOW_MS saves but
// mails nobody; a submit after acceptance never says "קיבלנו".

let athlete: Record<string, unknown> | null;
let card: Record<string, unknown>;
let mailLog: { candidate_id: string; template: string; created_at: string }[];
const notify = vi.fn();
const received = vi.fn((u: { candidateId?: string }) => {
  mailLog.push({ candidate_id: u.candidateId!, template: 'academy_form_received', created_at: new Date().toISOString() });
});
const staffPush = vi.fn();
const accept = vi.fn();

vi.mock('@/lib/email', () => ({
  notifyAdminNewAcademyRegistration: (u: unknown) => notify(u),
  notifyAcademyFormReceived: (u: any) => received(u),
}));
vi.mock('@/lib/notifications/staff', () => ({
  notifyStaff: (o: unknown) => { staffPush(o); return Promise.resolve({ recipients: 1, sent: 1 }); },
  academyManagerIds: () => Promise.resolve([]),
}));
vi.mock('@/lib/academy/intake-server', () => ({
  recordFormCandidate: () => Promise.resolve('cand-1'),
  invitePrefill: () => Promise.resolve(null),
}));
vi.mock('@/lib/academy/registration', () => ({ mayRegister: () => Promise.resolve(true) }));
vi.mock('@/lib/academy/link-server', () => ({ likelyClubMember: () => Promise.resolve(null) }));
vi.mock('@/lib/academy/sheet-import-server', () => ({
  acceptImported: async () => { accept(); card.accepted_at = new Date().toISOString(); return { accepted: true }; },
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const f: Record<string, unknown> = {};
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => { f[k] = v; return chain; },
        gte: (k: string, v: unknown) => { f[`${k}>=`] = v; return chain; },
        limit: () => chain,
        update: () => chain,
        insert: () => chain,
        single: () => Promise.resolve({ data: { id: 'new-1' }, error: null }),
        maybeSingle: () => Promise.resolve({ data: table === 'academy_candidates' ? card : athlete, error: null }),
        then: (resolve: (v: unknown) => unknown) => {
          if (table === 'email_log') {
            const data = mailLog.filter(r => r.candidate_id === f.candidate_id && r.template === f.template && r.created_at >= String(f['created_at>=']));
            return Promise.resolve({ data, error: null }).then(resolve);
          }
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return chain;
    },
  }),
}));

const { POST, FORM_RESEND_WINDOW_MS } = await import('@/app/api/academy/register/route');

let ipSeq = 0;
const post = async (payload: Record<string, unknown> = {}) => (await POST(new Request('https://x.test/api/academy/register', {
  method: 'POST', headers: { 'x-forwarded-for': `10.9.0.${++ipSeq}` },
  body: JSON.stringify({ name: 'Ofir Hayun', email: 'ofir@example.com', ...payload }),
}))).json();

const IMPORTED = { source: 'existing', intake: { _import: { invitedBy: { athleteId: 'mgr' } } }, athlete_id: 'a-1' };

beforeEach(() => {
  athlete = null; card = { source: 'new' }; mailLog = [];
  [notify, received, staffPush, accept].forEach(m => m.mockClear());
});

describe('academy register idempotency', () => {
  it('a 10-minute window, as a constant', () => {
    expect(FORM_RESEND_WINDOW_MS).toBe(10 * 60_000);
  });

  it('the first submit still sends everything', async () => {
    expect(await post()).toEqual({ success: true });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledTimes(1);
    expect(staffPush).toHaveBeenCalledTimes(1);
  });

  it('a double submit inside the window sends once', async () => {
    await post();
    await post();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledTimes(1);
    expect(staffPush).toHaveBeenCalledTimes(1);
  });

  it('sends again once the window has passed', async () => {
    mailLog.push({ candidate_id: 'cand-1', template: 'academy_form_received', created_at: new Date(Date.now() - FORM_RESEND_WINDOW_MS - 60_000).toISOString() });
    await post();
    expect(received).toHaveBeenCalledTimes(1);
  });

  it('a submit after acceptance (no ?i=, the 11-18 path) sends no "received" mail and says alreadyIn', async () => {
    athlete = { id: 'a-1', approved: true, onboarding_status: 'active' };
    card = { ...IMPORTED, accepted_at: '2026-11-18T18:06:50Z' };
    expect(await post()).toEqual({ success: true, alreadyIn: true });
    expect(received).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(staffPush).not.toHaveBeenCalled();
  });

  it('the auto-accept of an imported card runs exactly once across repeat submits', async () => {
    athlete = { id: 'a-1', approved: false, onboarding_status: 'academy_pending' };
    card = { ...IMPORTED, accepted_at: null };
    const token = 'a'.repeat(32);
    expect(await post({ inviteToken: token })).toMatchObject({ success: true, letIn: true });
    expect(await post({ inviteToken: token })).toMatchObject({ success: true, letIn: true, alreadyIn: true });
    expect(accept).toHaveBeenCalledTimes(1);
    expect(received).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
