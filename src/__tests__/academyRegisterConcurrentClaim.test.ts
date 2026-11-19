import { describe, expect, it, vi, beforeEach } from 'vitest';

// Two submits of the same card in the same instant both passed the email_log "sent recently?"
// read, so both mailed. The route now claims the send with a conditional UPDATE on
// academy_candidates.form_mail_claimed_at (migration 178, NOT applied); only the request that
// gets a row back mails. This fake db applies that UPDATE atomically, like the row lock does.

let card: Record<string, unknown>;
let mailLog: { candidate_id: string; template: string; created_at: string }[];
let claimColumn: boolean;
const notify = vi.fn();
const received = vi.fn();
const staffPush = vi.fn();
const tick = () => new Promise(r => setTimeout(r, 0));

vi.mock('@/lib/email', () => ({
  notifyAdminNewAcademyRegistration: (u: unknown) => notify(u),
  notifyAcademyFormReceived: async (u: { candidateId?: string }) => {
    await tick(); // the log row lands after a delay, which is the whole race
    mailLog.push({ candidate_id: u.candidateId!, template: 'academy_form_received', created_at: new Date().toISOString() });
    received(u);
  },
}));
vi.mock('@/lib/notifications/staff', () => ({
  notifyStaff: (o: unknown) => { staffPush(o); return Promise.resolve({ recipients: 1, sent: 1 }); },
  academyManagerIds: () => Promise.resolve([]),
}));
vi.mock('@/lib/academy/intake-server', () => ({
  recordFormCandidate: async () => { await tick(); return 'cand-1'; },
  invitePrefill: () => Promise.resolve(null),
}));
vi.mock('@/lib/academy/registration', () => ({ mayRegister: () => Promise.resolve(true) }));
vi.mock('@/lib/academy/link-server', () => ({ likelyClubMember: () => Promise.resolve(null) }));
vi.mock('@/lib/academy/sheet-import-server', () => ({ acceptImported: async () => ({ accepted: false }) }));

function fakeDb() {
  return {
    from(table: string) {
      const f: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      let orFilter = '';
      let selected = false;
      const run = () => {
        if (table === 'email_log') {
          const data = mailLog.filter(r => r.candidate_id === f.candidate_id && r.template === f.template && r.created_at >= String(f['created_at>=']));
          return { data, error: null };
        }
        if (table === 'academy_candidates' && patch && 'form_mail_claimed_at' in patch) {
          if (!claimColumn) return { data: null, error: { code: 'PGRST204', message: "Could not find the 'form_mail_claimed_at' column" } };
          // Atomic compare-and-set: evaluated and applied in one synchronous step.
          const since = /form_mail_claimed_at\.lt\.(.+)$/.exec(orFilter)![1];
          const cur = card.form_mail_claimed_at as string | null | undefined;
          if (f.id === 'cand-1' && (cur == null || cur < since)) {
            card.form_mail_claimed_at = patch.form_mail_claimed_at;
            return { data: selected ? [{ id: 'cand-1' }] : null, error: null };
          }
          return { data: selected ? [] : null, error: null };
        }
        return { data: null, error: null };
      };
      const chain: any = {
        select: () => { if (patch) selected = true; return chain; },
        eq: (k: string, v: unknown) => { f[k] = v; return chain; },
        gte: (k: string, v: unknown) => { f[`${k}>=`] = v; return chain; },
        or: (s: string) => { orFilter = s; return chain; },
        limit: () => chain,
        update: (p: Record<string, unknown>) => { patch = p; return chain; },
        insert: () => chain,
        single: () => Promise.resolve({ data: { id: 'new-1' }, error: null }),
        maybeSingle: () => Promise.resolve({ data: table === 'academy_candidates' ? card : null, error: null }),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
      };
      return chain;
    },
  };
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => fakeDb() }));

const { POST, claimFormMail, FORM_RESEND_WINDOW_MS } = await import('@/app/api/academy/register/route');

let ipSeq = 0;
const post = () => POST(new Request('https://x.test/api/academy/register', {
  method: 'POST', headers: { 'x-forwarded-for': `10.8.0.${++ipSeq}` },
  body: JSON.stringify({ name: 'Ofir Hayun', email: 'ofir@example.com' }),
})).then(r => r.json());

beforeEach(() => {
  card = { source: 'new', form_mail_claimed_at: null }; mailLog = []; claimColumn = true;
  [notify, received, staffPush].forEach(m => m.mockClear());
});

describe('academy register: concurrent submits claim the mails once', () => {
  it('two submits racing send one set of mails and one staff push', async () => {
    const [a, b] = await Promise.all([post(), post()]);
    expect(a).toEqual({ success: true });
    expect(b).toEqual({ success: true });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledTimes(1);
    expect(staffPush).toHaveBeenCalledTimes(1);
  });

  it('five racing submits still send once', async () => {
    await Promise.all([post(), post(), post(), post(), post()]);
    expect(received).toHaveBeenCalledTimes(1);
    expect(staffPush).toHaveBeenCalledTimes(1);
  });

  it('two afterSave claims on the same card: exactly one wins', async () => {
    const db = fakeDb();
    const r = await Promise.all([claimFormMail(db, 'cand-1'), claimFormMail(db, 'cand-1')]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it('a claim older than the window is won again', async () => {
    card.form_mail_claimed_at = new Date(Date.now() - FORM_RESEND_WINDOW_MS - 60_000).toISOString();
    await post();
    expect(received).toHaveBeenCalledTimes(1);
  });

  it('without migration 178 it falls back to the email_log check (and the race is still open)', async () => {
    claimColumn = false;
    await post();
    await post();
    expect(received).toHaveBeenCalledTimes(1); // sequential repeat: caught by email_log
    mailLog = []; received.mockClear();
    await Promise.all([post(), post()]);
    expect(received).toHaveBeenCalledTimes(2); // documents why the column is needed
  });
});
