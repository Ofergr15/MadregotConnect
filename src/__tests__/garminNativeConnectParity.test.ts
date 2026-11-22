import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Native Garmin connect routes must do what the web connect does after a successful
// connect: re-send the workouts waiting for the watch (25 s ceiling, never fails the
// connect) and start an activity sync. Identity is the JWT's athlete only.

const h = vi.hoisted(() => ({
  send: vi.fn(),
  sync: vi.fn(),
  after: vi.fn(),
  store: vi.fn(),
  exchange: vi.fn(),
  login: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('next/server', async (orig) => ({ ...(await orig<any>()), after: h.after }));
vi.mock('@/lib/auth-session', () => ({
  requireAthlete: vi.fn(async () => ({ ok: true, user: { athleteId: 'ath-jwt' } })),
  authError: (r: any) => new Response(JSON.stringify({ error: r.error }), { status: r.status }),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
vi.mock('@/lib/data-sources/server', () => ({
  storeGarminTokens: h.store,
  loadDataSourcesStatus: vi.fn(async () => ({ garmin: { state: 'connected' } })),
}));
vi.mock('@/lib/garmin/auth-mfa', () => ({
  exchangeTicketForTokens: h.exchange,
  garminLogin: h.login,
  garminVerifyMfa: h.verify,
}));
vi.mock('@/lib/data-sources/native', () => ({
  garminNativeServiceUrl: () => 'https://x/svc',
  isPlausibleGarminTicket: (t: unknown) => typeof t === 'string' && t.length > 3,
}));
vi.mock('@/lib/watch/reconnect', async (orig) => ({ ...(await orig<any>()), sendWaitingAfterReconnect: h.send }));
vi.mock('@/app/api/garmin/sync-activities/route', () => ({ runSyncRequest: h.sync }));

import { POST as ticketPOST } from '@/app/api/me/data-sources/garmin/ticket/route';
import { POST as passwordPOST } from '@/app/api/me/data-sources/garmin/password/route';

const req = (body: unknown) => new Request('http://t/x', { method: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer j' } });
const flush = () => new Promise((r) => setImmediate(r));

const legs: Array<{ name: string; ok: () => Promise<Response>; fail: () => Promise<Response> }> = [
  {
    name: 'ticket',
    ok: () => ticketPOST(req({ ticket: 'ST-123' })),
    fail: () => { h.exchange.mockRejectedValue(new Error('no')); return ticketPOST(req({ ticket: 'ST-123' })); },
  },
  {
    name: 'password',
    ok: () => passwordPOST(req({ email: 'a@b.c', password: 'pw', athleteId: 'someone-else' })),
    fail: () => { h.login.mockResolvedValue({ error: 'bad credentials' }); return passwordPOST(req({ email: 'a@b.c', password: 'pw' })); },
  },
  {
    name: 'password MFA leg',
    ok: () => passwordPOST(req({ email: 'a@b.c', sessionId: 's1', mfaCode: '123456' })),
    fail: () => { h.verify.mockResolvedValue({ error: 'bad code' }); return passwordPOST(req({ email: 'a@b.c', sessionId: 's1', mfaCode: '1' })); },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.send.mockResolvedValue(3);
  h.sync.mockResolvedValue(new Response('{}'));
  h.after.mockImplementation((fn: () => unknown) => { void fn(); });
  h.store.mockResolvedValue(undefined);
  h.exchange.mockResolvedValue({ oauth1: 'T' });
  h.login.mockResolvedValue({ tokens: { oauth1: 'T' } });
  h.verify.mockResolvedValue({ tokens: { oauth1: 'T' } });
});
afterEach(() => vi.useRealTimers());

for (const leg of legs) {
  describe(`native garmin connect parity — ${leg.name}`, () => {
    it('re-sends waiting workouts and starts a sync for the JWT athlete, returns watchResent', async () => {
      const res = await leg.ok();
      await flush();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, watchResent: 3 });
      expect(JSON.stringify(body)).not.toMatch(/oauth1/);
      expect(h.send).toHaveBeenCalledWith('ath-jwt');
      expect(h.sync).toHaveBeenCalledTimes(1);
      const syncReq = h.sync.mock.calls[0][0] as Request;
      expect(await syncReq.json()).toEqual({ athleteId: 'ath-jwt' });
    });

    it('still succeeds with watchResent 0 when the resend throws', async () => {
      h.send.mockRejectedValue(new Error('garmin down'));
      const res = await leg.ok();
      expect(res.status).toBe(200);
      expect((await res.json()).watchResent).toBe(0);
    });

    it('still succeeds with watchResent 0 when the resend times out (25 s)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      h.send.mockReturnValue(new Promise(() => {}));
      const p = leg.ok();
      await vi.advanceTimersByTimeAsync(25_001);
      const res = await p;
      expect(res.status).toBe(200);
      expect((await res.json()).watchResent).toBe(0);
    });

    it('still succeeds when the sync throws', async () => {
      h.sync.mockRejectedValue(new Error('boom'));
      const res = await leg.ok();
      await flush();
      expect(res.status).toBe(200);
    });

    it('calls neither on a failed connect', async () => {
      const res = await leg.fail();
      await flush();
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(h.send).not.toHaveBeenCalled();
      expect(h.sync).not.toHaveBeenCalled();
      expect(h.after).not.toHaveBeenCalled();
    });
  });
}
