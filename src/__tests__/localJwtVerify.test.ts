import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { ageJwksCacheForTest, JWKS_MAX_STALE_MS, JWKS_TTL_MS, resetJwksCache, verifyAccessTokenLocally } from '@/lib/auth/local-jwt';

const URL_ = 'https://proj.supabase.co';
const b64 = (b: Uint8Array | string) => Buffer.from(b).toString('base64url');

async function keypair(kid: string) {
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await webcrypto.subtle.exportKey('jwk', kp.publicKey)), kid, alg: 'ES256' };
  return { kp, jwk };
}

async function sign(priv: CryptoKey, kid: string, payload: Record<string, unknown>, alg = 'ES256') {
  const h = b64(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const p = b64(JSON.stringify(payload));
  const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64(new Uint8Array(sig))}`;
}

const good = (over: Record<string, unknown> = {}) => ({
  sub: 'u1', email: 'Runner@Example.com', aud: 'authenticated', role: 'authenticated', iss: `${URL_}/auth/v1`,
  exp: Math.floor(Date.now() / 1000) + 3600, ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
let a: Awaited<ReturnType<typeof keypair>>;

beforeEach(async () => {
  resetJwksCache();
  a = await keypair('kid-a');
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ keys: [a.jwk] })));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('local JWT verification', () => {
  it('accepts a valid ES256 token and reads the email from the verified payload', async () => {
    const v = await verifyAccessTokenLocally(await sign(a.kp.privateKey, 'kid-a', good()), URL_);
    expect(v).toEqual({ kind: 'valid', email: 'runner@example.com', sub: 'u1' });
  });

  it('caches the JWKS: one fetch for many verifications', async () => {
    for (let i = 0; i < 5; i++) await verifyAccessTokenLocally(await sign(a.kp.privateKey, 'kid-a', good()), URL_);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired token (401, no network fallback)', async () => {
    const v = await verifyAccessTokenLocally(await sign(a.kp.privateKey, 'kid-a', good({ exp: 1000 })), URL_);
    expect(v.kind).toBe('invalid');
  });

  it('rejects a token signed by the wrong key under a published kid', async () => {
    const evil = await keypair('kid-a');
    const v = await verifyAccessTokenLocally(await sign(evil.kp.privateKey, 'kid-a', good()), URL_);
    expect(v).toEqual({ kind: 'invalid', reason: 'signature' });
  });

  it('rejects a tampered payload', async () => {
    const t = await sign(a.kp.privateKey, 'kid-a', good());
    const [h, , s] = t.split('.');
    const forged = `${h}.${b64(JSON.stringify(good({ email: 'admin@club.com' })))}.${s}`;
    expect((await verifyAccessTokenLocally(forged, URL_)).kind).toBe('invalid');
  });

  it('rejects another audience or issuer', async () => {
    expect((await verifyAccessTokenLocally(await sign(a.kp.privateKey, 'kid-a', good({ aud: 'x' })), URL_)).kind).toBe('invalid');
    expect((await verifyAccessTokenLocally(await sign(a.kp.privateKey, 'kid-a', good({ iss: 'https://other/auth/v1' })), URL_)).kind).toBe('invalid');
  });

  it('rejects a token with no iss', async () => {
    expect(await verifyAccessTokenLocally(await sign(a.kp.privateKey, 'kid-a', good({ iss: undefined })), URL_)).toEqual({ kind: 'invalid', reason: 'issuer' });
  });

  it('rejects a non-user role (anon / service_role / missing)', async () => {
    for (const role of ['anon', 'service_role', undefined]) {
      expect(await verifyAccessTokenLocally(await sign(a.kp.privateKey, 'kid-a', good({ role })), URL_)).toEqual({ kind: 'invalid', reason: 'role' });
    }
  });

  it('rejects a JWK whose kty does not match the alg', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ keys: [{ ...a.jwk, kty: 'RSA', alg: undefined }] })));
    expect(await verifyAccessTokenLocally(await sign(a.kp.privateKey, 'kid-a', good()), URL_)).toEqual({ kind: 'invalid', reason: 'kty-mismatch' });
  });

  it('serves stale keys after a failed refresh, but only up to the max-stale cap', async () => {
    const t = await sign(a.kp.privateKey, 'kid-a', good());
    expect((await verifyAccessTokenLocally(t, URL_)).kind).toBe('valid');
    fetchMock.mockRejectedValue(new Error('down'));
    ageJwksCacheForTest(JWKS_TTL_MS + 1);
    expect((await verifyAccessTokenLocally(t, URL_)).kind).toBe('valid'); // stale, within cap
    ageJwksCacheForTest(JWKS_MAX_STALE_MS);
    expect(await verifyAccessTokenLocally(t, URL_)).toEqual({ kind: 'fallback', reason: 'jwks-unavailable' });
  });

  it('falls back to the network check when the JWKS is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    const v = await verifyAccessTokenLocally(await sign(a.kp.privateKey, 'kid-a', good()), URL_);
    expect(v.kind).toBe('fallback');
  });

  it('falls back for a legacy HS256 token and for an unknown kid', async () => {
    const hs = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify(good()))}.sig`;
    expect((await verifyAccessTokenLocally(hs, URL_)).kind).toBe('fallback');
    const other = await keypair('kid-b');
    expect((await verifyAccessTokenLocally(await sign(other.kp.privateKey, 'kid-b', good()), URL_)).kind).toBe('fallback');
  });

  it('picks up a rotated key after a forced refresh', async () => {
    await verifyAccessTokenLocally(await sign(a.kp.privateKey, 'kid-a', good()), URL_);
    const b = await keypair('kid-b');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ keys: [a.jwk, b.jwk] })));
    expect((await verifyAccessTokenLocally(await sign(b.kp.privateKey, 'kid-b', good()), URL_)).kind).toBe('valid');
  });

  it('CAVEAT pinned: a revoked-but-unexpired token still verifies locally (bounded by exp)', async () => {
    // Supabase revocation (sign-out elsewhere) is only visible to getUser. Locally a
    // well-signed token passes until exp; this test exists so changing that is a decision.
    const t = await sign(a.kp.privateKey, 'kid-a', good({ session_id: 'revoked-session' }));
    expect((await verifyAccessTokenLocally(t, URL_)).kind).toBe('valid');
  });
});
