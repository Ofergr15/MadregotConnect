import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Signing out has to actually sign you out.
 *
 * It did not. `supabase.auth.signOut()` drops the session out of localStorage,
 * but the `mc_device` cookie is httpOnly — signed proof that this browser once
 * logged in, with a one-year lifetime — and four routes set it while NOTHING
 * deleted it. So sign-out cleared the session, sent them to '/', and the landing
 * page's own recovery read the surviving cookie, minted a fresh session and
 * redirected back to /auth/resolve. Reported as "it refreshes and stays logged
 * in", which is exactly what it did.
 */

// ── the route ──────────────────────────────────────────────────────────────────
const { POST } = await import('@/app/api/auth/sign-out/route');
const { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS } = await import('@/lib/auth/device-token');

describe('POST /api/auth/sign-out', () => {
  it('expires the device cookie', async () => {
    const res = await POST();
    const cookie = res.cookies.get(DEVICE_COOKIE);
    expect(cookie?.value).toBe('');
    expect(cookie?.maxAge).toBe(0);
  });

  it('clears it at the path that set it, so the deletion actually lands', () => {
    // A '/'-scoped cookie "deleted" at a different path silently survives, which
    // would reproduce the whole bug while looking fixed.
    expect(DEVICE_COOKIE_OPTIONS.path).toBe('/');
    expect(readFileSync(new URL('../app/api/auth/sign-out/route.ts', import.meta.url), 'utf8'))
      .toContain('DEVICE_COOKIE_OPTIONS');
  });
});

// ── the client helper ──────────────────────────────────────────────────────────
let fetched: string[];
const supabaseSignOut = vi.fn();
const removed: string[] = [];

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({ auth: { signOut: () => supabaseSignOut() } }),
}));

const { signOutEverywhere } = await import('@/lib/auth/sign-out');
const { IDENTITY_KEYS } = await import('@/lib/auth/identity-keys');

beforeEach(() => {
  fetched = [];
  removed.length = 0;
  supabaseSignOut.mockReset().mockResolvedValue({ error: null });
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return { ok: true, json: async () => ({ ok: true }) };
  });
  // clearIdentityKeys no-ops on the server, so it needs to look like a browser.
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: (k: string) => { removed.push(k); },
  });
});

describe('signOutEverywhere', () => {
  it('drops all four claims this browser holds on an identity', async () => {
    await signOutEverywhere();
    // 1. the device cookie — the one that was missing
    expect(fetched).toContain('/api/auth/sign-out');
    // 2. the Supabase session
    expect(supabaseSignOut).toHaveBeenCalled();
    // 3. every identity key, including the elevated ones ('admin_session',
    //    'view_as_role') that used to be inherited by whoever signed in next
    for (const key of IDENTITY_KEYS) expect(removed).toContain(key);
    // 4. a pending login verifier the landing page would otherwise claim
    expect(removed).toContain('mc_login_handoff');
  });

  it('deletes the cookie BEFORE revoking the session', async () => {
    // Order matters: the caller navigates to '/' straight after, and while the
    // cookie is alive that page can mint a new session on arrival.
    const order: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { order.push(`fetch:${url}`); return { ok: true, json: async () => ({}) }; });
    supabaseSignOut.mockImplementation(async () => { order.push('signOut'); return { error: null }; });
    await signOutEverywhere();
    expect(order).toEqual(['fetch:/api/auth/sign-out', 'signOut']);
  });

  it('still clears the browser when the network call fails', async () => {
    // A failed sign-out must never trap somebody on the screen they are leaving.
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    supabaseSignOut.mockRejectedValue(new Error('offline'));
    await expect(signOutEverywhere()).resolves.toBeUndefined();
    for (const key of IDENTITY_KEYS) expect(removed).toContain(key);
  });

  it('stops the silent-session recovery from re-minting on the way out', async () => {
    const { trySilentReauth } = await import('@/lib/auth/silent-reauth');
    await signOutEverywhere();
    // The latch is set, so this returns null without even asking the route —
    // which matters on a soft navigation, where the module keeps its state.
    fetched = [];
    expect(await trySilentReauth()).toBeNull();
    expect(fetched).toEqual([]);
  });
});

// ── nobody sneaks a partial sign-out back in ───────────────────────────────────
describe('every sign-out goes through the shared helper', () => {
  it('no component calls auth.signOut() as its own sign-out', () => {
    // Five places each hand-rolled this and each got it wrong differently. The
    // exceptions are the two lib helpers that deliberately clear only the LOCAL
    // session: api.ts recovering from a dead token, and clear-local-identity
    // making room for a new login without forgetting the device.
    const allowed = new Set([
      'lib/api.ts',
      'lib/auth/clear-local-identity.ts',
      'lib/auth/sign-out.ts',
      // Names it in a comment explaining what it exists to fix.
      'app/api/auth/sign-out/route.ts',
    ]);
    const offenders: string[] = [];
    const walk = (dir: URL, rel: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__') continue;
        const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
        const childRel = `${rel}${entry.name}`;
        if (entry.isDirectory()) { walk(child, `${childRel}/`); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (allowed.has(childRel)) continue;
        if (/auth\.signOut\(/.test(readFileSync(child, 'utf8'))) offenders.push(childRel);
      }
    };
    walk(new URL('../', import.meta.url), '');
    expect(offenders).toEqual([]);
  });
});
