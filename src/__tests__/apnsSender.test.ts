import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, verify } from 'crypto';
import {
  APNS_HOSTS,
  APNS_MAX_BYTES,
  TOKEN_REUSE_SEC,
  apnsConfig,
  buildApnsRequest,
  buildProviderToken,
  classifyApnsResponse,
  http2Transport,
  providerToken,
  resetProviderToken,
  sendApns,
  type ApnsConfig,
  type ApnsTransport,
} from '@/lib/apns';

/**
 * The APNs sender, with the HTTP layer always mocked. A throwaway P-256 key is generated per run;
 * no real key, Key ID or Team ID exists anywhere in the repo. Nothing here reaches Apple.
 */

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const ENV = { APNS_KEY_P8: PEM, APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: 'TEAM123456', APNS_TOPIC: 'club.madregot.app', APNS_ENV: 'sandbox' };
const TOKEN = 'a'.repeat(64);
const cfg = () => apnsConfig(ENV)!;
const ok: ApnsTransport = async () => ({ status: 200, body: '' });

beforeEach(() => resetProviderToken());

describe('apnsConfig fails closed', () => {
  it('is null with nothing set (the default everywhere today)', () => {
    expect(apnsConfig({})).toBeNull();
  });
  it.each(['APNS_KEY_P8', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_TOPIC', 'APNS_ENV'])('is null without %s', (k) => {
    expect(apnsConfig({ ...ENV, [k]: undefined })).toBeNull();
  });
  it('has no default host: an unknown APNS_ENV is "off", never production', () => {
    expect(apnsConfig({ ...ENV, APNS_ENV: 'prod' })).toBeNull();
    expect(apnsConfig({ ...ENV, APNS_ENV: '' })).toBeNull();
  });
  it('rejects malformed ids, topic and keys', () => {
    expect(apnsConfig({ ...ENV, APNS_KEY_ID: 'short' })).toBeNull();
    expect(apnsConfig({ ...ENV, APNS_TEAM_ID: 'lowercase12' })).toBeNull();
    expect(apnsConfig({ ...ENV, APNS_TOPIC: 'nodots' })).toBeNull();
    expect(apnsConfig({ ...ENV, APNS_KEY_P8: 'not a key' })).toBeNull();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(apnsConfig({ ...ENV, APNS_KEY_P8: rsa })).toBeNull(); // ES256 needs an EC P-256 key
  });
  it('accepts a complete configuration, including a PEM pasted with "\\n" escapes', () => {
    expect(cfg()).toMatchObject({ keyId: 'ABC123DEFG', teamId: 'TEAM123456', topic: 'club.madregot.app', environment: 'sandbox' });
    expect(apnsConfig({ ...ENV, APNS_KEY_P8: PEM.replace(/\n/g, '\\n') })).not.toBeNull();
  });
});

describe('the ES256 provider token', () => {
  it('is header {alg:ES256,kid} . claims {iss,iat} . a valid raw r||s signature', () => {
    const jwt = buildProviderToken(cfg(), 1_700_000_000);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({ iss: 'TEAM123456', iat: 1_700_000_000 });
    const sig = Buffer.from(s, 'base64url');
    expect(sig.length).toBe(64);
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig)).toBe(true);
  });
  it('is reused for 50 minutes, then minted afresh', () => {
    const t0 = 1_700_000_000;
    const a = providerToken(cfg(), t0);
    expect(providerToken(cfg(), t0 + TOKEN_REUSE_SEC - 1)).toBe(a);
    expect(providerToken(cfg(), t0 + TOKEN_REUSE_SEC)).not.toBe(a);
  });
});

describe('the HTTP/2 request', () => {
  it('alert: POST /3/device/{token} on the configured host with the APNs headers', () => {
    const r = buildApnsRequest(cfg(), TOKEN, { title: 'כותרת', body: 'גוף', url: '/feed', tag: 'plan-1', badge: 3, id: '11111111-1111-1111-1111-111111111111', data: { nid: 'n' } }, 'JWT');
    expect(r.host).toBe(APNS_HOSTS.sandbox);
    expect(r.path).toBe(`/3/device/${TOKEN}`);
    expect(r.headers).toEqual({
      authorization: 'bearer JWT', 'apns-topic': 'club.madregot.app', 'apns-push-type': 'alert', 'apns-priority': '10',
      'apns-expiration': '0', 'content-type': 'application/json', 'apns-collapse-id': 'plan-1', 'apns-id': '11111111-1111-1111-1111-111111111111',
    });
    expect(JSON.parse(r.body)).toEqual({ aps: { alert: { title: 'כותרת', body: 'גוף' }, sound: 'default', badge: 3, 'thread-id': 'plan-1' }, url: '/feed', nid: 'n' });
  });
  it('background: content-available, push-type background, priority 5, no alert', () => {
    const r = buildApnsRequest(cfg(), TOKEN, { title: 't', body: 'b', pushType: 'background' }, 'JWT');
    expect(r.headers['apns-push-type']).toBe('background');
    expect(r.headers['apns-priority']).toBe('5');
    expect(JSON.parse(r.body)).toEqual({ aps: { 'content-available': 1 } });
  });
  it('production config → production host; collapse id capped at 64 bytes', () => {
    const prod = apnsConfig({ ...ENV, APNS_ENV: 'production' })!;
    const r = buildApnsRequest(prod, TOKEN, { title: 't', body: 'b', tag: 'x'.repeat(100) }, 'JWT');
    expect(r.host).toBe('api.push.apple.com');
    expect(Buffer.byteLength(r.headers['apns-collapse-id'])).toBeLessThanOrEqual(64);
  });
});

describe("Apple's answers", () => {
  it.each([
    [200, '', 'sent'],
    [410, '{"reason":"Unregistered"}', 'invalid-token'],
    [400, '{"reason":"BadDeviceToken"}', 'invalid-token'],
    [400, '{"reason":"DeviceTokenNotForTopic"}', 'invalid-token'],
    [400, '{"reason":"PayloadEmpty"}', 'failed'],
    [403, '{"reason":"ExpiredProviderToken"}', 'auth-error'],
    [403, '{"reason":"InvalidProviderToken"}', 'auth-error'],
    [429, '{"reason":"TooManyRequests"}', 'failed'],
    [503, 'not json', 'failed'],
  ] as const)('%i %s → %s', (status, body, outcome) => {
    expect(classifyApnsResponse(status, body).outcome).toBe(outcome);
  });
});

describe('sendApns', () => {
  it('with no configuration makes no request at all', async () => {
    const transport = vi.fn(ok);
    expect(await sendApns(TOKEN, { title: 't', body: 'b' }, { config: null, transport })).toEqual({ outcome: 'not-configured', status: null, reason: null });
    expect(transport).not.toHaveBeenCalled();
  });
  it('reads the environment by default, and the environment here has no APNs keys', async () => {
    const transport = vi.fn(ok);
    expect((await sendApns(TOKEN, { title: 't', body: 'b' }, { transport })).outcome).toBe('not-configured');
    expect(transport).not.toHaveBeenCalled();
  });
  it('sends through the injected transport and reports 200 as sent', async () => {
    const transport = vi.fn(ok);
    expect((await sendApns(TOKEN, { title: 't', body: 'b' }, { config: cfg(), transport })).outcome).toBe('sent');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0].host).toBe('api.sandbox.push.apple.com');
  });
  it('410 → invalid-token (the caller clears it)', async () => {
    const r = await sendApns(TOKEN, { title: 't', body: 'b' }, { config: cfg(), transport: async () => ({ status: 410, body: '{"reason":"Unregistered"}' }) });
    expect(r).toEqual({ outcome: 'invalid-token', status: 410, reason: 'Unregistered' });
  });
  it('403 ExpiredProviderToken drops the cached provider token so the next send mints a new one', async () => {
    const seen: string[] = [];
    const transport: ApnsTransport = async (req) => { seen.push(req.headers.authorization); return { status: 403, body: '{"reason":"ExpiredProviderToken"}' }; };
    await sendApns(TOKEN, { title: 't', body: 'b' }, { config: cfg(), transport, nowSec: 1_700_000_000 });
    await sendApns(TOKEN, { title: 't', body: 'b' }, { config: cfg(), transport, nowSec: 1_700_000_001 });
    expect(seen[0]).not.toBe(seen[1]);
  });
  it('a malformed token or an oversized payload is refused before any request', async () => {
    const transport = vi.fn(ok);
    expect((await sendApns('XYZ', { title: 't', body: 'b' }, { config: cfg(), transport })).outcome).toBe('invalid-token');
    expect((await sendApns(TOKEN, { title: 't', body: 'x'.repeat(APNS_MAX_BYTES) }, { config: cfg(), transport })).reason).toBe('PayloadTooLarge');
    expect(transport).not.toHaveBeenCalled();
  });
  it('a transport error is a failed outcome, never a throw', async () => {
    const r = await sendApns(TOKEN, { title: 't', body: 'b' }, { config: cfg(), transport: async () => { throw new Error('ECONNRESET'); } });
    expect(r).toEqual({ outcome: 'failed', status: null, reason: 'ECONNRESET' });
  });
  it('the real HTTP/2 transport refuses to run under the test runner', async () => {
    await expect(http2Transport({ host: APNS_HOSTS.sandbox, path: `/3/device/${TOKEN}`, headers: {}, body: '{}' })).rejects.toThrow(/disabled under tests/);
  });
});
