import { describe, expect, it, vi, beforeAll } from 'vitest';
import { generateKeyPairSync, createVerify } from 'crypto';

// The viewing copies at Mux (Ofer chose Mux, 2026-10-23): playback links are signed for
// one video and expire; the copy job never stores past its minutes ceiling.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
beforeAll(() => {
  process.env.MUX_SIGNING_KEY_ID = 'kid123';
  process.env.MUX_SIGNING_KEY_PRIVATE = Buffer.from(privateKey.export({ type: 'pkcs1', format: 'pem' }) as string).toString('base64');
  process.env.MUX_TOKEN_ID = 'id'; process.env.MUX_TOKEN_SECRET = 'secret'; process.env.MUX_MAX_MINUTES = '2';
});

let stored: string | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ storage: { from: () => ({
    download: async () => ({ data: stored ? new Blob([stored]) : null }),
    upload: async (_p: string, body: string) => { stored = body; return { error: null }; },
  }) } }),
}));
const { muxHls, signMux, syncMuxCopies } = await import('@/lib/photos/mux');

describe('a playback link', () => {
  it('is an RS256 JWT for one video that the public key verifies, and expires', () => {
    const now = Date.parse('2026-10-23T10:00:00Z');
    const jwt = signMux('play1', 'v', {}, now)!;
    const [h, b, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toMatchObject({ alg: 'RS256', kid: 'kid123' });
    const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
    expect(claims).toMatchObject({ sub: 'play1', aud: 'v' });
    expect(claims.exp * 1000).toBeGreaterThan(now + 5 * 3600_000);
    expect(createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(true);
  });
  it('only for a ready copy', () => {
    expect(muxHls({ a: 'x', s: 'preparing', p: 'play1' })).toBeNull();
    expect(muxHls({ a: 'x', s: 'ready', p: 'play1' })).toMatch(/^https:\/\/stream\.mux\.com\/play1\.m3u8\?token=/);
  });
});

describe('the copy job', () => {
  it('sends the newest first, and stops at the minutes ceiling', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      sent.push(body.passthrough);
      return new Response(JSON.stringify({ data: { id: `asset-${body.passthrough}`, playback_ids: [{ id: `pb-${body.passthrough}`, policy: 'signed' }] } }), { status: 201 });
    }));
    const videos = ['a', 'b', 'c'].map((id) => ({ id, ms: 50_000, src: () => `https://app/v/${id}` }));
    const r = await syncMuxCopies(videos, Date.now() + 5000);
    // 2-minute ceiling, 50 s each: two fit, the third would pass it.
    expect(sent).toEqual(['a', 'b']);
    expect(r).toMatchObject({ sent: 2, preparing: 2 });
    expect(JSON.parse(stored!).a).toMatchObject({ a: 'asset-a', s: 'preparing', p: 'pb-a' });
    vi.unstubAllGlobals();
  });
});
