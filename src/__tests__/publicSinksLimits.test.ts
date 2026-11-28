// Task 78: the two session-less write routes are size-capped, rate-limited, and name a caller
// only from a verified bearer. Synthetic endpoints/callers only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRateLimiter } from '@/lib/academy/intake';

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<object>()), resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
const updates: unknown[] = [];
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from() {
      const c: any = {
        update: (p: unknown) => { updates.push(p); return c; }, select: () => c, eq: () => c, is: () => c, gte: () => c,
        order: () => c, limit: () => c, maybeSingle: async () => ({ data: null }),
        then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r),
      };
      return c;
    },
  }),
}));
const sinks = await import('@/lib/public-sinks');
const { POST: receipt } = await import('@/app/api/push/receipt/route');
const { POST: clientLog } = await import('@/app/api/client-log/route');

let ipN = 0;
const freshIp = () => `10.0.0.${++ipN}`;
const req = (url: string, body: string, ip = freshIp(), extra: Record<string, string> = {}) =>
  new Request(`https://example.test${url}`, { method: 'POST', body, headers: { 'x-forwarded-for': ip, ...extra } });
const EP = 'https://web.push.apple.com/QabcDEF123';

beforeEach(() => { updates.length = 0; resolveVerifiedCaller.mockReset(); });

describe('readCappedJson / endpoint / redact', () => {
  it('refuses a body over the cap even when content-length is absent', async () => {
    const r = await sinks.readCappedJson(new Request('https://x', { method: 'POST', body: 'x'.repeat(50) }), 10);
    expect(r).toEqual({ ok: false, reason: 'too_large' });
  });
  it('counts bytes, not chars (Hebrew is 2 bytes)', async () => {
    const r = await sinks.readCappedJson(new Request('https://x', { method: 'POST', body: JSON.stringify('שששש') }), 8);
    expect(r).toEqual({ ok: false, reason: 'too_large' });
  });
  it('parses a small body; flags bad JSON', async () => {
    expect(await sinks.readCappedJson(new Request('https://x', { method: 'POST', body: '{"a":1}' }), 100)).toEqual({ ok: true, body: { a: 1 } });
    expect(await sinks.readCappedJson(new Request('https://x', { method: 'POST', body: '{' }), 100)).toEqual({ ok: false, reason: 'bad_json' });
  });
  it.each([[EP, true], ['http://web.push.apple.com/x', false], ['not a url', false], [123, false], ['https://a/' + 'x'.repeat(2000), false]])(
    'plausible endpoint %s → %s', (v, ok) => expect(sinks.isPlausiblePushEndpoint(v)).toBe(ok));
  it('redacts credential-looking keys at depth', () => {
    expect(sinks.redactSecrets({ event: 'e', data: { access_token: 'a', nested: { password: 'p', ok: 1 } } }))
      .toEqual({ event: 'e', data: { access_token: '[redacted]', nested: { password: '[redacted]', ok: 1 } } });
  });
  it('limiter blocks past the limit inside the window, resets after', () => {
    const allow = createRateLimiter(2, 1000);
    expect([allow('k', 0), allow('k', 1), allow('k', 2), allow('k', 1001)]).toEqual([true, true, false, true]);
  });
});

describe('POST /api/push/receipt', () => {
  it('valid endpoint: 204 and the stamp is written', async () => {
    expect((await receipt(req('/api/push/receipt', JSON.stringify({ endpoint: EP })))).status).toBe(204);
    expect(updates.length).toBeGreaterThan(0);
  });
  it('a non-https endpoint is a 400, nothing written', async () => {
    expect((await receipt(req('/api/push/receipt', JSON.stringify({ endpoint: 'http://x/y' })))).status).toBe(400);
    expect(updates).toHaveLength(0);
  });
  it('an oversized body is 413 before any lookup', async () => {
    const res = await receipt(req('/api/push/receipt', JSON.stringify({ endpoint: EP, pad: 'x'.repeat(3000) })));
    expect(res.status).toBe(413);
    expect(updates).toHaveLength(0);
  });
  it('the 61st receipt from one IP in a minute is 429', async () => {
    const ip = freshIp();
    for (let i = 0; i < 60; i++) await receipt(req('/api/push/receipt', JSON.stringify({ endpoint: EP }), ip));
    updates.length = 0;
    expect((await receipt(req('/api/push/receipt', JSON.stringify({ endpoint: EP }), ip))).status).toBe(429);
    expect(updates).toHaveLength(0);
  });
});

describe('POST /api/client-log', () => {
  it('logs anonymously without a bearer, secrets redacted, body identity ignored', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await clientLog(req('/api/client-log', JSON.stringify({ event: 'e', athleteId: 'claimed', data: { token: 't' } })));
    const line = JSON.parse(log.mock.calls.at(-1)![1] as string);
    expect(line.caller).toBeNull();
    expect(line.body.data.token).toBe('[redacted]');
    expect(resolveVerifiedCaller).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it('names the caller from a verified bearer', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: 'a-1' } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await clientLog(req('/api/client-log', '{"event":"e"}', freshIp(), { authorization: 'Bearer x' }));
    expect(JSON.parse(log.mock.calls.at(-1)![1] as string).caller).toBe('a-1');
    log.mockRestore();
  });
  it('a bad bearer logs anonymously', async () => {
    resolveVerifiedCaller.mockResolvedValue({ denied: new Response(null, { status: 401 }), caller: {} });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await clientLog(req('/api/client-log', '{"event":"e"}', freshIp(), { authorization: 'Bearer bad' }));
    expect(JSON.parse(log.mock.calls.at(-1)![1] as string).caller).toBeNull();
    log.mockRestore();
  });
  it('413 over 4 KB, 429 past 30/min, malformed stays ok', async () => {
    expect((await clientLog(req('/api/client-log', JSON.stringify({ p: 'x'.repeat(5000) })))).status).toBe(413);
    expect((await clientLog(req('/api/client-log', '{'))).status).toBe(200);
    const ip = freshIp();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (let i = 0; i < 30; i++) await clientLog(req('/api/client-log', '{}', ip));
    expect((await clientLog(req('/api/client-log', '{}', ip))).status).toBe(429);
  });
});
