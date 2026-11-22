import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, verify } from 'crypto';
import { apnsConfig, buildApnsPayload, providerToken, sendApns, type ApnsRequest } from '@/lib/apns';

// A throwaway P-256 key generated per run — never a real APNs key.
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const env = (over: Record<string, string | undefined> = {}) =>
  ({ APNS_KEY_ID: 'KEYID12345', APNS_TEAM_ID: 'TEAM123456', APNS_KEY_P8: pem, ...over }) as unknown as NodeJS.ProcessEnv;

describe('apnsConfig', () => {
  it('is null when any key env var is missing — APNs is skipped silently', () => {
    expect(apnsConfig({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(apnsConfig(env({ APNS_KEY_ID: undefined }))).toBeNull();
    expect(apnsConfig(env({ APNS_TEAM_ID: '' }))).toBeNull();
    expect(apnsConfig(env({ APNS_KEY_P8: undefined }))).toBeNull();
  });
  it('is null (not a throw) for an unreadable key', () => {
    expect(apnsConfig(env({ APNS_KEY_P8: 'not a key' }))).toBeNull();
  });
  it('defaults to production + app.madregot.ios; APNS_ENV=sandbox picks the sandbox host', () => {
    const prod = apnsConfig(env())!;
    expect(prod.host).toBe('https://api.push.apple.com');
    expect(prod.bundleId).toBe('app.madregot.ios');
    expect(apnsConfig(env({ APNS_ENV: 'sandbox' }))!.host).toBe('https://api.sandbox.push.apple.com');
  });
  it('accepts a key pasted with literal \\n escapes (one-line env var)', () => {
    expect(apnsConfig(env({ APNS_KEY_P8: pem.trim().replace(/\n/g, '\\n') }))).not.toBeNull();
  });
});

describe('providerToken', () => {
  it('is an ES256 JWT with kid + iss + iat that verifies against the key', () => {
    const cfg = apnsConfig(env())!;
    const jwt = providerToken(cfg, 1_800_000_000);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEYID12345' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({ iss: 'TEAM123456', iat: 1_800_000_000 });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
  });
});

describe('buildApnsPayload', () => {
  it('puts url at the top level, where PushTap.url(from:) reads it', () => {
    const p = buildApnsPayload({ title: 'T', body: 'B', url: '/feed?activity=1', tag: 'kudos', kind: 'kudos' }, { nid: 'n1', badge: 3, athleteId: 'a1' });
    expect(p.url).toBe('/feed?activity=1');
    expect(p.aps).toEqual({ alert: { title: 'T', body: 'B' }, badge: 3, sound: 'default', 'thread-id': 'kudos' });
    expect(p).toMatchObject({ nid: 'n1', athleteId: 'a1', kind: 'kudos' });
  });
  it('omits url when the push has none', () => {
    expect('url' in buildApnsPayload({ title: 'T', body: 'B' }, { nid: 'n', badge: 1, athleteId: 'a' })).toBe(false);
  });
});

describe('sendApns', () => {
  const cfg = apnsConfig(env())!;
  it('POSTs /3/device/<token> with the topic, push type and bearer token', async () => {
    let seen: ApnsRequest | null = null;
    const r = await sendApns(cfg, 'ab'.repeat(32), { aps: {} }, {
      collapseId: 'tag1',
      transport: async (req) => { seen = req; return { status: 200, body: '' }; },
    });
    expect(r).toEqual({ ok: true, status: 200, reason: null, dead: false });
    expect(seen!.path).toBe(`/3/device/${'ab'.repeat(32)}`);
    expect(seen!.headers).toMatchObject({ 'apns-topic': 'app.madregot.ios', 'apns-push-type': 'alert', 'apns-collapse-id': 'tag1' });
    expect(seen!.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });
  it('410 Unregistered is dead; BadDeviceToken is a failure but NOT dead (env mismatch must not wipe tokens)', async () => {
    const gone = await sendApns(cfg, 'aa', {}, { transport: async () => ({ status: 410, body: '{"reason":"Unregistered"}' }) });
    expect(gone).toMatchObject({ ok: false, dead: true, reason: 'Unregistered' });
    const bad = await sendApns(cfg, 'aa', {}, { transport: async () => ({ status: 400, body: '{"reason":"BadDeviceToken"}' }) });
    expect(bad).toMatchObject({ ok: false, dead: false, reason: 'BadDeviceToken' });
  });
  it('never throws on a transport error', async () => {
    const r = await sendApns(cfg, 'aa', {}, { transport: async () => { throw new Error('ECONNRESET'); } });
    expect(r).toMatchObject({ ok: false, status: 0, dead: false });
  });
});
