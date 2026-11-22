import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The Garmin credential never leaves the server (2026-11-21).
 *
 * `athletes.garmin_auth` decrypts to OAuth tokens that are the athlete's Garmin
 * account. The exchange routes used to return the encrypted blob and the browser
 * posted it back to /api/athletes/connect. Pinned here:
 *  - responses carry a status, never `auth`, `tokens`, or anything token-shaped;
 *  - the target row is resolved BEFORE Garmin is called, and an anonymous caller
 *    or a member naming someone else is refused without a Garmin round trip;
 *  - /api/athletes/connect no longer writes a client-supplied blob;
 *  - no client page posts one.
 */

const SECRET_TOKEN = 'SECRET-oauth2-access-token-xyz';
const SECRET_BLOB = 'ENCRYPTED-BLOB-abc';

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async () => {
  const real = await vi.importActual<typeof import('@/lib/auth/self-or-staff')>('@/lib/auth/self-or-staff');
  return { mayActFor: real.mayActFor, resolveVerifiedCaller: (req: Request) => resolveVerifiedCaller(req) };
});

const garminLogin = vi.fn();
const garminVerifyMfa = vi.fn();
vi.mock('@/lib/garmin/auth-mfa', () => ({
  garminLogin: (...a: unknown[]) => garminLogin(...a),
  garminVerifyMfa: (...a: unknown[]) => garminVerifyMfa(...a),
}));

const getOauth1Token = vi.fn();
vi.mock('garmin-connect', () => ({
  GarminConnect: class {
    client = { getOauth1Token: (...a: unknown[]) => getOauth1Token(...a), getOauth2Token: async () => ({}) };
    exportToken() { return { oauth1: { oauth_token: SECRET_TOKEN }, oauth2: { access_token: SECRET_TOKEN } }; }
  },
}));

vi.mock('@/lib/encryption', () => ({ encrypt: () => SECRET_BLOB }));
vi.mock('@/lib/onboarding/events', () => ({ recordOnbEvent: async () => {}, deviceFromUa: () => 'test' }));
vi.mock('@/lib/watch/reconnect', () => ({
  sendWaitingAfterReconnect: async () => 2,
  withinMs: (p: Promise<number>) => p,
}));

type Row = { id: string; status: string };
let rowsByToken: Record<string, Row> = {};
let rowsByEmail: Record<string, Row> = {};
let updates: Array<{ id: unknown; patch: Record<string, unknown> }> = [];

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from() {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const chain: any = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        or: () => chain,
        update: (p: Record<string, unknown>) => { patch = p; return chain; },
        eq: (col: string, v: unknown) => {
          filters[col] = v;
          if (patch && col === 'id') updates.push({ id: v, patch });
          return chain;
        },
        maybeSingle: async () => {
          if ('invite_token' in filters) return { data: rowsByToken[filters.invite_token as string] ?? null, error: null };
          if ('email' in filters) return { data: rowsByEmail[filters.email as string] ?? null, error: null };
          return { data: null, error: null };
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res),
      };
      return chain;
    },
  }),
}));

const me = { email: 'me@x', isSuperUser: false, canApprove: false, isStaff: false, athleteId: 'me', role: 'runner', isCoreRunner: false };

function post(url: string, body: unknown, bearer = false): Request {
  return new Request(`http://x${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer jwt' } : {}) },
    body: JSON.stringify(body),
  });
}

async function call(route: 'authenticate' | 'ticket-auth', req: Request) {
  const mod = route === 'authenticate'
    ? await import('@/app/api/garmin/authenticate/route')
    : await import('@/app/api/garmin/ticket-auth/route');
  const res = await mod.POST(req as any);
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}

function expectNoCredential(text: string) {
  expect(text).not.toContain(SECRET_TOKEN);
  expect(text).not.toContain(SECRET_BLOB);
  expect(text).not.toMatch(/"auth"|garmin_auth|oauth|access_token|tokens/i);
}

beforeEach(() => {
  rowsByToken = { tok: { id: 'invitee', status: 'invited' } };
  rowsByEmail = { 'new@x': { id: 'newbie', status: 'invited' }, 'active@x': { id: 'vet', status: 'active' } };
  updates = [];
  resolveVerifiedCaller.mockReset();
  garminLogin.mockReset().mockResolvedValue({ success: true, tokens: { oauth1: { t: SECRET_TOKEN }, oauth2: { t: SECRET_TOKEN } } });
  garminVerifyMfa.mockReset().mockResolvedValue({ success: true, tokens: { oauth1: { t: SECRET_TOKEN }, oauth2: {} } });
  getOauth1Token.mockReset().mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('/api/garmin/authenticate', () => {
  it('signed-in self: stores the credential server-side and answers with a status only', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: me });
    const r = await call('authenticate', post('/api/garmin/authenticate', { email: 'g@x', password: 'pw' }, true));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ connected: true, watchResent: 2 });
    expectNoCredential(r.text);
    expect(updates.find((u) => u.patch.garmin_auth)?.id).toBe('me');
  });

  it('MFA step: same status-only answer', async () => {
    rowsByToken.tok = { id: 'invitee', status: 'invited' };
    const r = await call('authenticate', post('/api/garmin/authenticate', { inviteToken: 'tok', mfaCode: '1', sessionId: 's' }));
    expect(r.json).toEqual({ connected: true, watchResent: 2 });
    expectNoCredential(r.text);
    expect(updates.find((u) => u.patch.garmin_auth)?.id).toBe('invitee');
  });

  it('needs-MFA answer carries the session id and nothing else', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: me });
    garminLogin.mockResolvedValue({ mfaRequired: true, sessionId: 'sess' });
    const r = await call('authenticate', post('/api/garmin/authenticate', { email: 'g@x', password: 'pw' }, true));
    expect(r.json).toEqual({ mfaRequired: true, sessionId: 'sess' });
    expect(updates).toEqual([]);
  });

  it('refuses an anonymous caller before talking to Garmin', async () => {
    const r = await call('authenticate', post('/api/garmin/authenticate', { email: 'g@x', password: 'pw' }));
    expect(r.status).toBe(401);
    expect(garminLogin).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('refuses a member naming another athlete', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: me });
    const r = await call('authenticate', post('/api/garmin/authenticate', { athleteId: 'someone-else', email: 'g@x', password: 'pw' }, true));
    expect(r.status).toBe(403);
    expect(garminLogin).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('lets staff connect a named athlete', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { ...me, isStaff: true, role: 'coach' } });
    const r = await call('authenticate', post('/api/garmin/authenticate', { athleteId: 'other', email: 'g@x', password: 'pw' }, true));
    expect(r.status).toBe(200);
    expect(updates.find((u) => u.patch.garmin_auth)?.id).toBe('other');
  });

  it('passes through a rejected bearer', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response('{}', { status: 401 }), caller: me });
    const r = await call('authenticate', post('/api/garmin/authenticate', { email: 'g@x', password: 'pw' }, true));
    expect(r.status).toBe(401);
    expect(garminLogin).not.toHaveBeenCalled();
  });

  // signupEmail (2026-11-22): the address alone proves nothing. Two pending applicants,
  // A = new@x (row 'newbie') and B = other@x; neither row is linked to a session yet.
  const pendingA = { ...me, email: 'new@x', athleteId: null };
  const pendingB = { ...me, email: 'other@x', athleteId: null };
  const body = (signupEmail: string) => ({ signupEmail, email: 'g@x', password: 'pw' });

  it('signupEmail WITHOUT a bearer is refused before Garmin, for a pending row too', async () => {
    const r = await call('authenticate', post('/api/garmin/authenticate', body('new@x')));
    expect(r.status).toBe(401);
    expect(garminLogin).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('no bearer: an unknown address and a pending one get the SAME answer (no enumeration)', async () => {
    const pending = await call('authenticate', post('/api/garmin/authenticate', body('new@x')));
    const unknown = await call('authenticate', post('/api/garmin/authenticate', body('nobody@x')));
    const active = await call('authenticate', post('/api/garmin/authenticate', body('active@x')));
    expect([pending.status, unknown.status, active.status]).toEqual([401, 401, 401]);
    expect(pending.text).toBe(unknown.text);
    expect(active.text).toBe(unknown.text);
  });

  it('pending A, signed in, naming their OWN address: stores onto their row', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: pendingA });
    const r = await call('authenticate', post('/api/garmin/authenticate', body('new@x'), true));
    expect(r.status).toBe(200);
    expectNoCredential(r.text);
    expect(updates.map((u) => u.id)).toContain('newbie');
  });

  it("pending B, signed in, naming A's address: refused before Garmin, A's row untouched", async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: pendingB });
    const r = await call('authenticate', post('/api/garmin/authenticate', body('new@x'), true));
    expect(r.status).toBe(403);
    expect(garminLogin).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(r.text).not.toMatch(/newbie|invited|account_not_found/);
  });

  it("B naming A's address answers exactly like B naming an unknown address (no state leak)", async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: pendingB });
    const a = await call('authenticate', post('/api/garmin/authenticate', body('new@x'), true));
    const u = await call('authenticate', post('/api/garmin/authenticate', body('nobody@x'), true));
    expect(a.status).toBe(u.status);
    expect(a.text).toBe(u.text);
  });

  it('own address but the row is active: not door 3 — an unlinked session is refused', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { ...me, email: 'active@x', athleteId: null } });
    const r = await call('authenticate', post('/api/garmin/authenticate', body('active@x'), true));
    expect(r.status).toBe(403);
    expect(garminLogin).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('ticket-auth: the same rule (B cannot name A)', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: pendingB });
    const r = await call('ticket-auth', post('/api/garmin/ticket-auth', { signupEmail: 'new@x', ticket: 'ST-abcdefgh123' }, true));
    expect(r.status).toBe(403);
    expect(getOauth1Token).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('/join/onboard sends its bearer with signupEmail', () => {
    const src = readFileSync(join(__dirname, '..', 'app/join/onboard/page.tsx'), 'utf8');
    expect(src).toMatch(/fetch\('\/api\/garmin\/authenticate', \{\s*method: 'POST',\s*headers: await apiHeaders\(true\)/);
  });

  it('a bad invite token is refused', async () => {
    const r = await call('authenticate', post('/api/garmin/authenticate', { inviteToken: 'nope', email: 'g@x', password: 'pw' }));
    expect(r.status).toBe(404);
    expect(garminLogin).not.toHaveBeenCalled();
  });

  it('never logs the password or tokens when the exchange throws', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: me });
    garminLogin.mockRejectedValue(Object.assign(new Error(`boom pw=hunter2 ${SECRET_TOKEN}`), { config: { data: 'password=hunter2' } }));
    const r = await call('authenticate', post('/api/garmin/authenticate', { email: 'g@x', password: 'hunter2' }, true));
    expect(r.status).toBe(500);
    const logged = JSON.stringify((console.error as any).mock.calls);
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain(SECRET_TOKEN);
  });
});

describe('/api/garmin/ticket-auth', () => {
  it('signed-in self: status only', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: me });
    const r = await call('ticket-auth', post('/api/garmin/ticket-auth', { ticket: 'ST-1' }, true));
    expect(r.json).toEqual({ connected: true, watchResent: 2 });
    expectNoCredential(r.text);
  });

  it('refuses an anonymous caller without exchanging the ticket', async () => {
    const r = await call('ticket-auth', post('/api/garmin/ticket-auth', { ticket: 'ST-1' }));
    expect(r.status).toBe(401);
    expect(getOauth1Token).not.toHaveBeenCalled();
  });

  it('refuses another user', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: me });
    const r = await call('ticket-auth', post('/api/garmin/ticket-auth', { ticket: 'ST-1', athleteId: 'x' }, true));
    expect(r.status).toBe(403);
    expect(getOauth1Token).not.toHaveBeenCalled();
  });

  it('never logs the ticket', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: me });
    getOauth1Token.mockRejectedValue(Object.assign(new Error('fail ST-SECRET-TICKET'), { config: { url: '?ticket=ST-SECRET-TICKET' } }));
    await call('ticket-auth', post('/api/garmin/ticket-auth', { ticket: 'ST-SECRET-TICKET' }, true));
    expect(JSON.stringify((console.error as any).mock.calls)).not.toContain('ST-SECRET-TICKET');
  });
});

describe('no client path carries the blob', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  it('/api/athletes/connect does not read garminAuth from the body', () => {
    const s = src('app/api/athletes/connect/route.ts');
    expect(s).not.toMatch(/const \{[^}]*garminAuth[^}]*\} = await req\.json\(\)/);
    expect(s).not.toMatch(/garmin_auth\s*=/);
    expect(s).not.toContain('encrypt(');
  });

  it.each([
    'app/join/onboard/page.tsx',
    'app/join/[token]/page.tsx',
    'app/join/academy/[token]/page.tsx',
    'app/(app)/dashboard/profile/page.tsx',
    'app/garmin-callback/page.tsx',
  ])('%s posts no garminAuth and reads no .auth', (p) => {
    const s = src(p);
    expect(s).not.toMatch(/garminAuth\s*:/);
    expect(s).not.toMatch(/(authData|data)\.auth\b/);
    expect(s).not.toContain("postMessage({ type: 'garmin-ticket', ticket }, '*')");
  });
});
