// Task 79: a bulk send cut by the time budget is NOT marked sent — the campaign goes back to
// `tested`, and the next send run mails only who was not attempted. Synthetic addresses only.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { closingStatus, remainingRecipients } from '@/lib/email/tracking';

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
vi.mock('@/lib/features/server', () => ({ isFeatureEnabled: async () => true }));
const sendEmail = vi.fn(async (_m: { to: string }) => ({ ok: true, status: 'sent', providerId: 'p', logId: 'l' }));
vi.mock('@/lib/email/send', () => ({ sendEmail: (m: { to: string }) => sendEmail(m) }));

let campaign: Record<string, unknown> = {};
let roster: Array<{ id: string; name: string; email: string }> = [];
let logged: Array<{ recipients: string[] }> = [];
const campaignUpdates: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      let isUpdate = false;
      const c: Record<string, unknown> = {};
      for (const k of ['eq', 'in', 'is', 'gte', 'order', 'limit', 'insert']) c[k] = () => c;
      c.select = () => c;
      c.update = (p: Record<string, unknown>) => { isUpdate = true; if (table === 'email_campaigns') campaignUpdates.push(p); return c; };
      c.maybeSingle = async () => ({ data: campaign, error: null });
      c.single = async () => ({ data: { id: 'child' }, error: null });
      c.then = (f: (v: unknown) => unknown) => {
        let data: unknown = [];
        if (isUpdate) data = [{ id: 'claimed' }];
        else if (table === 'athletes') data = roster;
        else if (table === 'email_log') data = logged;
        return Promise.resolve({ data, error: null }).then(f);
      };
      return c;
    },
  }),
}));
const { POST } = await import('@/app/api/admin/email-center/route');
const post = (body: unknown) => POST(new Request('http://x/api/admin/email-center', { method: 'POST', body: JSON.stringify(body) }));
const send = () => post({ action: 'send', campaignId: 'c1', confirm: 'שלח לכולם' });

beforeEach(() => {
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { email: 'me@example.test', athleteId: 'a0', role: 'admin', isSuperUser: false } });
  sendEmail.mockClear(); campaignUpdates.length = 0; logged = [];
  campaign = { id: 'c1', kind: 'newsletter', status: 'tested', recipient_count: 0, input: { title: 'עדכונים', items: [] } };
  roster = [1, 2, 3].map((i) => ({ id: `a${i}`, name: `R${i}`, email: `r${i}@example.test` }));
});
afterEach(() => vi.restoreAllMocks());

describe('pure helpers', () => {
  it('remainingRecipients skips any logged address, case-insensitive', () => {
    const people = [{ email: 'A@x.test' }, { email: 'b@x.test' }];
    expect(remainingRecipients(people, [{ recipients: ['a@x.test'] }])).toEqual([{ email: 'b@x.test' }]);
    expect(remainingRecipients(people, [])).toEqual(people);
  });
  it('only a complete pass closes as sent', () => {
    expect(closingStatus(0)).toBe('sent');
    expect(closingStatus(2)).toBe('tested');
  });
});

describe('bulk send under the budget', () => {
  it('a budget-cut pass is marked not sent (tested, no sent_at) with the attempted count', async () => {
    let n = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (++n <= 2 ? 0 : 1e9)); // budget runs out after the first send
    const res = await (await send()).json();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ sent: 1, notAttempted: 2, complete: false });
    expect(campaignUpdates.at(-1)).toMatchObject({ status: 'tested', sent_at: null, recipient_count: 1 });
  });
  it('the next run mails only who was not attempted, and closes as sent', async () => {
    logged = [{ recipients: ['r1@example.test'] }];
    campaign.recipient_count = 1;
    const res = await (await send()).json();
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['r2@example.test', 'r3@example.test']);
    expect(res).toMatchObject({ resumed: true, complete: true });
    expect(campaignUpdates.at(-1)).toMatchObject({ status: 'sent', recipient_count: 3 });
  });
  it('a failed address from the earlier pass is not retried (no double mail)', async () => {
    logged = [{ recipients: ['r1@example.test'] }, { recipients: ['r2@example.test'] }];
    await send();
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['r3@example.test']);
  });
  it('a resend child cannot be resumed through send (wrong audience)', async () => {
    campaign = { ...campaign, kind: 'resend_unopened' };
    expect((await send()).status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
