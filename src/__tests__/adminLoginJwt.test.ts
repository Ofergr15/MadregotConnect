// Task 77: /api/admin/login admits a signed-in admin/coach by their JWT; the shared password
// is a fallback behind ADMIN_PASSWORD_LOGIN=on (default off). Synthetic callers only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<object>()), resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
const createSyntheticSession = vi.fn(async () => ({ session: { access_token: 'a', refresh_token: 'r' }, error: null }));
vi.mock('@/lib/auth/synthetic-session', () => ({ createSyntheticSession: (...a: unknown[]) => createSyntheticSession(...(a as [])) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/auth/device-token', () => ({ DEVICE_COOKIE: 'mc_device', DEVICE_COOKIE_OPTIONS: {}, signDeviceToken: () => null }));
let athleteRow: unknown = { id: 'a1', email: 'coach@example.test', name: 'Coach', role: 'coach', group_id: 'g1' };
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: () => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: athleteRow }) }; return q; } }),
}));
const { POST } = await import('@/app/api/admin/login/route');
const { passwordLoginEnabled } = await import('@/lib/auth/admin-login');

const req = (body: object, bearer?: string) => new Request('http://x/api/admin/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
  body: JSON.stringify(body),
}) as any;
const as = (c: object) => resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { email: 'x@example.test', isSuperUser: false, isStaff: false, athleteId: 'a1', role: 'runner', ...c } });

const saved = { ...process.env };
beforeEach(() => { resolveVerifiedCaller.mockReset(); createSyntheticSession.mockClear(); delete process.env.ADMIN_PASSWORD_LOGIN; process.env.ADMIN_PASSWORD = 'pw'; });
afterEach(() => { process.env = { ...saved }; });

describe('admin login — JWT path', () => {
  it.each(['admin', 'coach'])('a signed-in %s is admitted, no new session minted', async (role) => {
    as({ role, isStaff: true });
    const res = await POST(req({}, 'jwt'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, role, athleteId: 'a1', session: null });
    expect(createSyntheticSession).not.toHaveBeenCalled();
  });
  it.each(['runner', 'academy_coach', 'core_runner'])('a signed-in %s gets 403', async (role) => {
    as({ role, isStaff: role === 'academy_coach' });
    expect((await POST(req({}, 'jwt'))).status).toBe(403);
  });
  it('an extra admin role (migration 127) counts', async () => {
    as({ role: 'runner', roles: ['runner', 'admin'] });
    expect((await POST(req({}, 'jwt'))).status).toBe(200);
  });
  it('the super user is admitted', async () => {
    as({ isSuperUser: true });
    expect((await POST(req({}, 'jwt'))).status).toBe(200);
  });
  it('an invalid token is rejected by the gate, the body email is ignored', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response('{}', { status: 401 }), caller: {} });
    expect((await POST(req({ email: 'coach@example.test', password: 'pw' }, 'bad'))).status).toBe(401);
    expect(createSyntheticSession).not.toHaveBeenCalled();
  });
});

describe('admin login — password fallback', () => {
  it('is off by default: the right password still gets 401', async () => {
    const res = await POST(req({ email: 'coach@example.test', password: 'pw' }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('password_login_disabled');
    expect(createSyntheticSession).not.toHaveBeenCalled();
  });
  it('works when ADMIN_PASSWORD_LOGIN=on', async () => {
    process.env.ADMIN_PASSWORD_LOGIN = 'on';
    const res = await POST(req({ email: 'coach@example.test', password: 'pw' }));
    expect(res.status).toBe(200);
    expect(createSyntheticSession).toHaveBeenCalledTimes(1);
  });
  it('wrong password stays 401 with the flag on', async () => {
    process.env.ADMIN_PASSWORD_LOGIN = 'on';
    expect((await POST(req({ email: 'other@example.test', password: 'nope' }))).status).toBe(401);
  });
  it('flag needs both the switch and a password', () => {
    expect(passwordLoginEnabled({})).toBe(false);
    expect(passwordLoginEnabled({ ADMIN_PASSWORD_LOGIN: 'on' })).toBe(false);
    expect(passwordLoginEnabled({ ADMIN_PASSWORD: 'x' })).toBe(false);
    expect(passwordLoginEnabled({ ADMIN_PASSWORD_LOGIN: 'true', ADMIN_PASSWORD: 'x' })).toBe(false);
    expect(passwordLoginEnabled({ ADMIN_PASSWORD_LOGIN: 'on', ADMIN_PASSWORD: 'x' })).toBe(true);
  });
});
