import { describe, expect, it, vi, beforeAll } from 'vitest';
import { generateKeyPairSync, createVerify } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

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
const { muxHls, muxPoster, signMux, syncMuxCopies } = await import('@/lib/photos/mux');

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
  const claimsOf = (url: string | null) => JSON.parse(Buffer.from(new URL(url!).searchParams.get('token')!.split('.')[1], 'base64url').toString());
  it('never opens under 720p (it began at 360p and climbed)', () => {
    expect(claimsOf(muxHls({ a: 'x', s: 'ready', p: 'play1' }))).toMatchObject({ aud: 'v', min_resolution: '720p' });
  });
  it('has the first frame, sharp, as its poster', () => {
    expect(muxPoster({ a: 'x', s: 'preparing', p: 'play1' })).toBeNull();
    const url = muxPoster({ a: 'x', s: 'ready', p: 'play1' });
    expect(url).toMatch(/^https:\/\/image\.mux\.com\/play1\/thumbnail\.webp\?token=/);
    expect(claimsOf(url)).toMatchObject({ aud: 't', width: 1080, time: 0 });
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

describe('the budget guard (Ofer, 10-23: "worried about the moment it starts to cost money")', () => {
  it('warns at half the free minutes and stops at 80%, each told once a month', async () => {
    const { budgetStage, FREE_DELIVERY_MINUTES: F } = await import('@/lib/photos/mux');
    expect(budgetStage(null, '2026-10', 100)).toMatchObject({ warn: false, stop: false });
    const half = budgetStage(null, '2026-10', F * 0.5);
    expect(half).toMatchObject({ warn: true, stop: false });
    const prev = { ...half.next, checkedAt: '' };
    expect(budgetStage(prev, '2026-10', F * 0.6)).toMatchObject({ warn: false, stop: false });
    const stop = budgetStage(prev, '2026-10', F * 0.8);
    expect(stop).toMatchObject({ warn: false, stop: true, next: { stopped: true } });
    // A new month starts clean.
    expect(budgetStage({ ...stop.next, checkedAt: '' }, '2026-11', 0)).toMatchObject({ warn: false, stop: false, next: { stopped: false, warned: false } });
  });
  it("a stop lasts the month it was for, and no copy is served or sent under it", async () => {
    const { budgetStopped } = await import('@/lib/photos/mux');
    const b = { month: '2026-10', minutes: 80_000, checkedAt: '', stopped: true };
    expect(budgetStopped(b, Date.parse('2026-10-30T12:00:00Z'))).toBe(true);
    expect(budgetStopped(b, Date.parse('2026-11-01T00:10:00Z'))).toBe(false);
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
    expect(read('src/app/api/photos/browse/folder/route.ts')).toMatch(/budgetStopped\(budget\) \? \{\} : map/);
    expect(read('src/lib/photos/mux.ts')).toMatch(/for \(const v of off \? \[\] : videos\)/);
  });
  it('its alerts go to the admins and Ofer, and are checked to have been SEEN', () => {
    const cron = readFileSync(join(process.cwd(), 'src/app/api/cron/photos-mirror/route.ts'), 'utf8');
    expect(cron).toMatch(/await sendConfirmedAlert\(\{\s*kind: 'video_budget'/);
    expect(cron).toMatch(/verifyPendingAlerts\(\)/);
    // 50% and 80% by email as well as push; the 'on' notice by push only.
    expect(cron).toMatch(/email: stage !== 'on'/);
  });
});
