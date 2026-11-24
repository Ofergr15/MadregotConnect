import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

// requireSession must verify an ES256 token locally (no getUser round trip), keep
// the 401 for a bad one, and still use getUser when it can't decide locally.

const getUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser } }) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from() {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, in: () => chain,
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({ data: [{ id: 'a1', email: 'runner@example.com', role: 'runner', status: 'active', approved: true }], error: null }).then(r),
      };
      return chain;
    },
  }),
}));
vi.mock('@/lib/maintenance', () => ({ readMaintenance: async () => null, maintenanceBlocks: () => false }));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

const { requireSession, clearSessionCache } = await import('@/lib/auth-session');
const { resetJwksCache } = await import('@/lib/auth/local-jwt');

const b64 = (b: Uint8Array | string) => Buffer.from(b).toString('base64url');
let kp: CryptoKeyPair;
let jwk: JsonWebKey & { kid: string };

async function sign(priv: CryptoKey, payload: Record<string, unknown>) {
  const h = b64(JSON.stringify({ alg: 'ES256', kid: 'k1', typ: 'JWT' }));
  const p = b64(JSON.stringify(payload));
  const s = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64(new Uint8Array(s))}`;
}
const claims = () => ({ email: 'runner@example.com', aud: 'authenticated', role: 'authenticated', iss: 'https://proj.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600 });
const req = (t: string) => new Request('http://x/api/feed', { headers: { authorization: `Bearer ${t}` } });

beforeEach(async () => {
  clearSessionCache(); resetJwksCache(); getUser.mockReset();
  kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  jwk = { ...(await webcrypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'ES256' };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }))));
});
afterEach(() => vi.unstubAllGlobals());

describe('requireSession + local JWT', () => {
  it('a valid ES256 token resolves with NO getUser call', async () => {
    const r = await requireSession(req(await sign(kp.privateKey, claims())));
    expect(r.ok).toBe(true);
    expect(r.ok && r.user.athleteId).toBe('a1');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('a wrong-key token is 401 without asking getUser', async () => {
    const evil = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const r = await requireSession(req(await sign(evil.privateKey, claims())));
    expect(r).toMatchObject({ ok: false, status: 401 });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('JWKS down → falls back to getUser, same semantics (503 on upstream 5xx)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    getUser.mockResolvedValue({ data: { user: null }, error: { status: 502, message: 'bad gateway' } });
    const r = await requireSession(req(await sign(kp.privateKey, claims())));
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it('JWKS down + getUser ok → signed in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    getUser.mockResolvedValue({ data: { user: { email: 'runner@example.com' } }, error: null });
    expect((await requireSession(req(await sign(kp.privateKey, claims())))).ok).toBe(true);
  });
});
