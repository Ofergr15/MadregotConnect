// B29: two submissions of the public form race. Only the request whose insert
// won notifies the approvers; the loser (23505 on the pending-email index) still
// answers ok and sends nothing. FIXTURE only; mail and push are stubbed.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// signups_open defaults off (lib/signups/open); these tests exercise the route with the door open.
vi.mock('@/lib/signups/open', () => ({ signupsOpen: async () => true, SIGNUPS_CLOSED_BODY: { error: 'signups-closed' } }));

let insertError: { code: string } | null = null;
function builder(table: string) {
  let op = 'select';
  const b: any = new Proxy({}, {
    get(_, k) {
      if (k === 'insert') return () => { op = 'insert'; return b; };
      if (k === 'then') return (res: any) => res(
        op === 'insert' ? { error: insertError } : table === 'signup_requests' ? { data: null, error: null, count: 1 } : { data: [], error: null });
      if (k === 'maybeSingle') return async () => ({ data: null, error: null });
      return () => b;
    },
  });
  return b;
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => builder(t) }) }));
const sent = { mail: 0, staff: 0, ack: 0 };
vi.mock('@/lib/email', () => ({
  notifyAdminNewSignupRequest: async () => { sent.mail++; },
  notifyRegistrationReceived: async () => { sent.ack++; },
}));
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: async () => { sent.staff++; } }));
vi.mock('@/lib/onboarding/events', () => ({ recordOnbEvent: async () => {}, deviceFromUa: () => null }));

const post = async () => {
  const { POST } = await import('@/app/api/public/signup/route');
  const res = await POST(new Request('http://x/api/public/signup', { method: 'POST', body: JSON.stringify({ email: 'new.person@example.test' }) }));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => { insertError = null; sent.mail = 0; sent.staff = 0; sent.ack = 0; });

describe('public signup: double submit', () => {
  it('the winning insert notifies the approvers (mail + push)', async () => {
    const r = await post();
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    expect(sent.mail).toBe(1);
    expect(sent.staff).toBe(1);
  });
  it('the losing insert (23505) answers ok and notifies nobody', async () => {
    insertError = { code: '23505' };
    const r = await post();
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    expect(sent).toEqual({ mail: 0, staff: 0, ack: 0 });
  });
  it('any other insert error is a 500, not a silent ok', async () => {
    insertError = { code: 'XX000' };
    expect((await post()).status).toBe(500);
    expect(sent.mail + sent.staff).toBe(0);
  });
});
