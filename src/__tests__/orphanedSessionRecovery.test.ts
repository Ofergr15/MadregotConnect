import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The dead end this whole pair of changes exists to close.
 *
 * A Supabase access token can be well-formed, correctly signed AND unexpired and
 * still be dead, because the session it names was revoked server-side. Supabase
 * answers `400 "Auth session missing!"` for one of those, and our routes turn
 * that into a 401. The app used to have no way out of it:
 *
 *  - `bearerHeaders()` re-mints only when there is NO session, and there is one;
 *  - `getSession()` keeps returning the corpse, because it only checks `exp`;
 *  - `autoRefreshToken` can't help, the refresh token is revoked too.
 *
 * So every screen showed a "try again" button whose only possible outcome was the
 * same 401, and clearing site data was the only escape. Observed in production on
 * 2026-09-05. These tests pin the recovery, and there is nothing about it that a
 * type or a build would catch.
 */

const fetchMock = vi.fn();
const trySilentReauth = vi.fn();
const signOut = vi.fn();
const bearerHeaders = vi.fn();

vi.mock('@/lib/auth/bearer-headers', () => ({ bearerHeaders: () => bearerHeaders() }));
vi.mock('@/lib/auth/silent-reauth', () => ({ trySilentReauth: () => trySilentReauth() }));
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({ auth: { signOut: (opts?: unknown) => signOut(opts) } }),
}));

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const unauthorized = { ok: false, status: 401, json: async () => ({ error: 'Invalid or expired session' }) };

async function loadFetcher() {
  vi.resetModules();
  return (await import('@/lib/api')).apiFetcher;
}

describe('apiFetcher recovery from an orphaned session', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    trySilentReauth.mockReset();
    signOut.mockReset();
    bearerHeaders.mockReset();
    bearerHeaders.mockResolvedValue({ Authorization: 'Bearer dead.but.wellformed' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-mints the session and retries once, so the screen loads instead of erroring', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized).mockResolvedValueOnce(ok({ items: [1] }));
    trySilentReauth.mockResolvedValue('fresh.token.here');

    const apiFetcher = await loadFetcher();
    await expect(apiFetcher('/api/feed')).resolves.toEqual({ items: [1] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The retry must carry the NEW token. Sending the dead one again is the bug.
    expect((fetchMock.mock.calls[1][1] as { headers: Record<string, string> }).headers.Authorization)
      .toBe('Bearer fresh.token.here');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('retries exactly once, so a still-401 route cannot loop', async () => {
    fetchMock.mockResolvedValue(unauthorized);
    trySilentReauth.mockResolvedValue('fresh.token.here');

    const apiFetcher = await loadFetcher();
    await expect(apiFetcher('/api/feed')).rejects.toThrow('Request failed: 401');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears the dead session locally when the browser cannot prove it logged in', async () => {
    fetchMock.mockResolvedValue(unauthorized);
    trySilentReauth.mockResolvedValue(null);

    const apiFetcher = await loadFetcher();
    await expect(apiFetcher('/api/feed')).rejects.toThrow('Request failed: 401');

    // ⚠️ scope MUST be local. The default 'global' asks Supabase to revoke
    // server-side sessions — a pointless failing round trip for a token that is
    // already orphaned, and on a shared account it would sign the user's OTHER
    // devices out, which is the exact harm being undone here.
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    // No third request: recovery failed, and repeating it cannot change that.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not try to recover a request that carried no credential at all', async () => {
    bearerHeaders.mockResolvedValue({});
    fetchMock.mockResolvedValue(unauthorized);

    const apiFetcher = await loadFetcher();
    await expect(apiFetcher('/api/feed')).rejects.toThrow('Request failed: 401');

    // bearerHeaders already tried to mint one; a 401 here just means "not logged
    // in", and signing an anonymous visitor out is not a thing.
    expect(trySilentReauth).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('leaves a successful request completely alone', async () => {
    fetchMock.mockResolvedValue(ok({ items: [] }));

    const apiFetcher = await loadFetcher();
    await expect(apiFetcher('/api/feed')).resolves.toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(trySilentReauth).not.toHaveBeenCalled();
  });

  it('does not mistake a 403 or a 500 for a dead session', async () => {
    for (const status of [403, 500, 503]) {
      fetchMock.mockReset();
      trySilentReauth.mockReset();
      fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({}) });

      const apiFetcher = await loadFetcher();
      await expect(apiFetcher('/api/feed')).rejects.toThrow(`Request failed: ${status}`);
      expect(trySilentReauth).not.toHaveBeenCalled();
    }
  });
});

/**
 * The root cause, pinned at the source level.
 *
 * `createSyntheticSession` used to rotate the auth user's password to mint a
 * session, and GoTrue drops a user's other sessions when their password changes —
 * so every login silently killed that account on every other device, which is
 * what produced the orphaned tokens above. Verified against production on
 * 2026-09-05: after a password-rotation mint the other device's token returned
 * `400 "Auth session missing!"`; after a magic-link mint it stayed valid.
 *
 * A test can't reach GoTrue, so this asserts the shape instead: the magic-link
 * path is the one that runs first, and the password rotation survives only as a
 * documented fallback.
 */
describe('synthetic-session mints without revoking other devices', () => {
  const source = () => {
    const { readFileSync } = require('fs') as typeof import('fs');
    const { fileURLToPath } = require('url') as typeof import('url');
    return readFileSync(
      fileURLToPath(new URL('../lib/auth/synthetic-session.ts', import.meta.url)),
      'utf8',
    );
  };

  it('reaches for a magic link before it reaches for a password', () => {
    const src = source();
    const magicLink = src.indexOf('generateLink');
    const rotation = src.indexOf('randomBytes(32)');
    expect(magicLink).toBeGreaterThan(-1);
    expect(rotation).toBeGreaterThan(-1);
    expect(magicLink).toBeLessThan(rotation);
  });

  it('redeems the link server-side and never puts a password in the result', () => {
    const src = source();
    expect(src).toMatch(/verifyOtp\(\{\s*type:\s*'email',\s*token_hash:/);
    expect(src).not.toMatch(/password:\s*password[,\s]*\}\s*\)\s*;?\s*$/m);
  });

  it('keeps the metadata merge off the password call, so it has no session cost', () => {
    // The old code set metadata and password in ONE updateUserById, which meant
    // refreshing a display name revoked every other device as a side effect.
    const src = source();
    const merge = src.match(/user_metadata:\s*\{\s*\.\.\.user\.user_metadata[^}]*\}/);
    expect(merge).not.toBeNull();
    const call = src.slice(src.indexOf('if (Object.keys(metadata).length > 0)'), src.indexOf('const authClient'));
    expect(call).toContain('user_metadata');
    expect(call).not.toContain('password');
  });

  it('still documents the fallback as the harmful branch', () => {
    expect(source()).toMatch(/FALLBACK ONLY/);
  });
});
