import { beforeEach, describe, expect, it, vi } from 'vitest';

/** /api/admin/email-center: admin-only, flag-gated, tests go to the caller only, and no
 *  send to everyone without a prior test and the typed confirmation. */

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
const flag = vi.fn(async () => true);
vi.mock('@/lib/features/server', () => ({ isFeatureEnabled: () => flag() }));
const sendEmail = vi.fn(async (_m: { to: string }) => ({ ok: true, status: 'sent', providerId: 'p', logId: 'l' }));
vi.mock('@/lib/email/send', () => ({ sendEmail: (m: { to: string }) => sendEmail(m) }));

let campaign: Record<string, unknown> | null = null;
const chain = (result: () => unknown) => {
  const c: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'in', 'is', 'gte', 'order', 'limit', 'update', 'insert']) c[k] = () => c;
  c.maybeSingle = async () => result();
  c.single = async () => result();
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(f);
  return c;
};
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: () => chain(() => ({ data: campaign, error: null })) }),
}));

const { GET, POST } = await import('@/app/api/admin/email-center/route');
const as = (role: string, isSuperUser = false) =>
  resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { email: 'me@club.com', athleteId: 'a1', role, isSuperUser, isStaff: role !== 'runner' } });
const post = (body: unknown) => POST(new Request('http://x/api/admin/email-center', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => { sendEmail.mockClear(); flag.mockResolvedValue(true); campaign = null; });

describe('email center gate', () => {
  it('refuses a coach (staff is not enough) and a runner', async () => {
    as('coach');
    expect((await GET(new Request('http://x/api/admin/email-center?preview=welcome'))).status).toBe(403);
    as('runner');
    expect((await post({ action: 'test', kind: 'welcome' })).status).toBe(403);
  });
  it('is 404 while the flag is off', async () => {
    as('admin'); flag.mockResolvedValue(false);
    expect((await GET(new Request('http://x/api/admin/email-center?preview=welcome'))).status).toBe(404);
  });
  it('previews for an admin', async () => {
    as('admin');
    const res = await GET(new Request('http://x/api/admin/email-center?preview=newsletter'));
    expect(res.status).toBe(200);
    expect((await res.json()).html).toContain('dir="rtl"');
  });
});

describe('sending', () => {
  it('a test goes to the caller only, whatever the body says', async () => {
    as('admin');
    const res = await post({ action: 'test', kind: 'welcome', to: 'everyone@club.com' });
    expect((await res.json()).ok).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe('me@club.com');
  });
  it('send needs the typed confirmation', async () => {
    as('admin');
    expect((await post({ action: 'send', campaignId: 'c1', confirm: 'yes' })).status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('send refuses an untested campaign', async () => {
    as('admin');
    campaign = { id: 'c1', status: 'draft', input: { title: 'עדכונים', items: [] } };
    expect((await post({ action: 'send', campaignId: 'c1', confirm: 'שלח לכולם' })).status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
