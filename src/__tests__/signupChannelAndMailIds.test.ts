// Leads server prep (migration 207): the two sign-up mails carry signup_request_id, the request and its
// register_submitted event carry the channel, and a pre-207 database still takes the request.
// FIXTURE only; mail, push and events are stubbed.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const inserts: Array<Record<string, unknown>> = [];
let missingChannelColumn = false;
let insertedThisPost = false;

function builder(table: string) {
  let op = 'select';
  let payload: Record<string, unknown> | null = null;
  const b: any = new Proxy({}, {
    get(_, k) {
      if (k === 'insert') return (row: Record<string, unknown>) => { op = 'insert'; payload = row; return b; };
      if (k === 'then') return (res: any) => {
        if (op === 'insert' && table === 'signup_requests') {
          inserts.push(payload!); insertedThisPost = true;
          return res({ error: missingChannelColumn && 'channel' in payload! ? { code: '42703' } : null });
        }
        return res(table === 'signup_requests' ? { data: null, error: null, count: 1 } : { data: [], error: null });
      };
      if (k === 'maybeSingle') return async () => (
        table === 'signup_requests' && op === 'select' && insertedThisPost ? { data: { id: 'req-1', created_at: 'now' }, error: null } : { data: null, error: null });
      return () => b;
    },
  });
  return b;
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => builder(t) }) }));
const mails: Array<{ kind: string; arg: any }> = [];
vi.mock('@/lib/email', () => ({
  notifyAdminNewSignupRequest: async (arg: any) => { mails.push({ kind: 'admin', arg }); },
  notifyRegistrationReceived: async (arg: any) => { mails.push({ kind: 'ack', arg }); },
}));
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: async () => {} }));
const events: any[] = [];
vi.mock('@/lib/onboarding/events', () => ({ recordOnbEvent: async (e: any) => { events.push(e); }, deviceFromUa: () => null }));

const post = async (extra: Record<string, unknown> = {}) => {
  insertedThisPost = false;
  const { POST } = await import('@/app/api/public/signup/route');
  const res = await POST(new Request('http://x/api/public/signup', {
    method: 'POST', headers: { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({ email: `p${Math.random().toString(36).slice(2, 8)}@example.test`, onb: 'v2', fullName: 'Test Person', ...extra }),
  }));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => { inserts.length = 0; mails.length = 0; events.length = 0; missingChannelColumn = false; });

describe('public signup → leads', () => {
  it('both sign-up mails carry the new request id', async () => {
    const r = await post();
    expect(r.status).toBe(200);
    expect(mails.map((m) => m.kind).sort()).toEqual(['ack', 'admin']);
    for (const m of mails) expect(m.arg.signupRequestId).toBe('req-1');
  });

  it('channel defaults to web and accepts app_ios / invite only', async () => {
    await post();
    await post({ channel: 'app_ios' });
    await post({ channel: 'invite' });
    await post({ channel: 'android; drop table' });
    expect(inserts.map((r) => r.channel)).toEqual(['web', 'app_ios', 'invite', 'web']);
    expect(events.map((e) => e.channel)).toEqual(['web', 'app_ios', 'invite', 'web']);
  });

  it('a database without migration 207 still takes the request (retried without channel)', async () => {
    missingChannelColumn = true;
    const r = await post({ channel: 'app_ios' });
    expect(r.status).toBe(200);
    expect(inserts).toHaveLength(2);
    expect('channel' in inserts[1]).toBe(false);
    expect(mails).toHaveLength(2);
  });
});

describe('channel helpers', () => {
  it('signup defaults to web; a client event with no channel stays unknown', async () => {
    const { signupChannel, eventChannel } = await import('@/lib/onboarding/channel');
    expect(signupChannel(undefined)).toBe('web');
    expect(signupChannel('app_ios')).toBe('app_ios');
    expect(eventChannel(undefined)).toBeNull();
    expect(eventChannel('nope')).toBeNull();
    expect(eventChannel('invite')).toBe('invite');
  });
});

describe('native_onboarding_setup', () => {
  it('is a known key, default off, and readable signed out (club scope) for the gateway register_view', async () => {
    const { FEATURES, PUBLIC_FEATURE_KEYS } = await import('@/lib/features/flags');
    expect(FEATURES.native_onboarding_setup.defaultEnabled).toBe(false);
    expect(PUBLIC_FEATURE_KEYS).toContain('native_onboarding_setup');
  });
});
