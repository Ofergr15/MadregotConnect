import { createPrivateKey, sign, type KeyObject } from 'crypto';

/**
 * Apple Push Notification service (APNs) sender — token-based (.p8) authentication over HTTP/2.
 *
 * DESIGN-COMPLETE, OFF BY DEFAULT. Nothing here talks to Apple unless every one of these is set
 * in the server's environment (none of them is in the repo, and none may ever be):
 *
 *   APNS_KEY_P8   the .p8 auth key's PEM text ("-----BEGIN PRIVATE KEY-----…"; "\n" escapes accepted)
 *   APNS_KEY_ID   the key's 10-character Key ID from the Apple Developer account
 *   APNS_TEAM_ID  the 10-character Team ID
 *   APNS_TOPIC    the iOS app's bundle id (the apns-topic header)
 *   APNS_ENV      exactly "sandbox" or "production" — there is NO default host: a missing or
 *                 misspelled value is "not configured", so a development build can never be
 *                 pointed at the production gateway by omission
 *
 * Fail closed: `apnsConfig()` returns null unless all five are valid, and `sendApns` then sends
 * nothing and says so. The HTTP layer is injectable (`ApnsTransport`); the default one refuses to
 * run under the test runner, so a test can never reach api.push.apple.com by accident.
 */

export type ApnsEnvironment = 'sandbox' | 'production';

export const APNS_HOSTS: Record<ApnsEnvironment, string> = {
  sandbox: 'api.sandbox.push.apple.com',
  production: 'api.push.apple.com',
};

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  topic: string;
  environment: ApnsEnvironment;
  /** The parsed EC P-256 private key. Never logged, never serialised. */
  key: KeyObject;
}

type Env = Record<string, string | undefined>;

const TEN_CHARS = /^[A-Z0-9]{10}$/;
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** The configuration, or null (= APNs off) unless every value is present and well formed. */
export function apnsConfig(env: Env = process.env): ApnsConfig | null {
  const pem = env.APNS_KEY_P8?.replace(/\\n/g, '\n').trim();
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  const topic = env.APNS_TOPIC?.trim();
  const environment = env.APNS_ENV?.trim();
  if (!pem || !keyId || !teamId || !topic || !environment) return null;
  if (!TEN_CHARS.test(keyId) || !TEN_CHARS.test(teamId) || !BUNDLE_ID.test(topic)) return null;
  if (environment !== 'sandbox' && environment !== 'production') return null;
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem, format: 'pem' });
  } catch {
    return null;
  }
  // APNs provider tokens are ES256 only: the key must be an EC P-256 key.
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
  return { keyId, teamId, topic, environment, key };
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/**
 * The provider authentication token: a JWT, ES256, header {alg, kid}, claims {iss: Team ID,
 * iat: seconds}. The signature is the raw 64-byte r||s form (JOSE), not DER.
 */
export function buildProviderToken(cfg: Pick<ApnsConfig, 'keyId' | 'teamId' | 'key'>, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: nowSec }));
  const signingInput = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: cfg.key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(signature)}`;
}

/**
 * Apple rejects a provider token older than an hour and throttles one refreshed more often than
 * every 20 minutes (TooManyProviderTokenUpdates), so one token is reused for 50 minutes per key.
 */
export const TOKEN_REUSE_SEC = 50 * 60;
let cachedToken: { kid: string; iss: string; iat: number; jwt: string } | null = null;

export function providerToken(cfg: ApnsConfig, nowSec = Math.floor(Date.now() / 1000)): string {
  if (cachedToken && cachedToken.kid === cfg.keyId && cachedToken.iss === cfg.teamId && nowSec - cachedToken.iat < TOKEN_REUSE_SEC) {
    return cachedToken.jwt;
  }
  const jwt = buildProviderToken(cfg, nowSec);
  cachedToken = { kid: cfg.keyId, iss: cfg.teamId, iat: nowSec, jwt };
  return jwt;
}

/** Forget the cached provider token (Apple said it is expired or invalid, or a test wants a clean slate). */
export function resetProviderToken(): void {
  cachedToken = null;
}

export interface ApnsNotification {
  title: string;
  body: string;
  /** Opened by the app on tap. */
  url?: string;
  /** Same tag = the newer notification replaces the older one (apns-collapse-id, max 64 bytes). */
  tag?: string;
  badge?: number;
  /** 'background' = a silent content-available push (no alert), e.g. "new plan, refresh". */
  pushType?: 'alert' | 'background';
  /** Extra keys for the app, outside `aps` (e.g. nid, kind, athleteId). */
  data?: Record<string, unknown>;
  /** Unix seconds after which Apple should stop trying; 0 = deliver now or never. Default 0. */
  expiration?: number;
  /** The push's own uuid, sent as apns-id so Apple's answer can be matched to it. */
  id?: string;
}

export interface ApnsRequest {
  host: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

/** Apple's limit for a regular push body. */
export const APNS_MAX_BYTES = 4096;

/** The exact HTTP/2 request for one device: POST https://{host}/3/device/{token}. */
export function buildApnsRequest(cfg: ApnsConfig, deviceToken: string, n: ApnsNotification, jwt: string): ApnsRequest {
  const background = n.pushType === 'background';
  const aps: Record<string, unknown> = background
    ? { 'content-available': 1 }
    : {
        alert: { title: n.title, body: n.body },
        sound: 'default',
        ...(n.badge != null ? { badge: n.badge } : {}),
        ...(n.tag ? { 'thread-id': n.tag } : {}),
      };
  const body = JSON.stringify({ aps, ...(n.url ? { url: n.url } : {}), ...(n.data ?? {}) });
  const headers: Record<string, string> = {
    authorization: `bearer ${jwt}`,
    'apns-topic': cfg.topic,
    'apns-push-type': background ? 'background' : 'alert',
    // Apple: a background push MUST be priority 5; an alert may be 10 (immediate).
    'apns-priority': background ? '5' : '10',
    'apns-expiration': String(n.expiration ?? 0),
    'content-type': 'application/json',
  };
  if (n.tag) headers['apns-collapse-id'] = Buffer.from(n.tag).subarray(0, 64).toString();
  if (n.id) headers['apns-id'] = n.id;
  return { host: APNS_HOSTS[cfg.environment], path: `/3/device/${deviceToken}`, headers, body };
}

export interface ApnsTransportResponse {
  status: number;
  body: string;
  headers?: Record<string, string | string[] | undefined>;
}

/** The one place that would touch the network. Injected in tests. */
export type ApnsTransport = (req: ApnsRequest) => Promise<ApnsTransportResponse>;

/**
 * The real HTTP/2 transport (node:http2). Refuses to run under the test runner, so no test can
 * reach Apple even if it forgets to inject a mock. One connection per call: correct and simple;
 * pooling is an optimisation for when volume justifies it.
 */
export const http2Transport: ApnsTransport = async (req) => {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    throw new Error('apns: the real transport is disabled under tests — inject a mock ApnsTransport');
  }
  const http2 = await import('node:http2');
  return new Promise<ApnsTransportResponse>((resolve, reject) => {
    const session = http2.connect(`https://${req.host}`);
    session.on('error', reject);
    const stream = session.request({ ':method': 'POST', ':path': req.path, ...req.headers });
    let status = 0;
    let headers: Record<string, string | string[] | undefined> = {};
    const chunks: Buffer[] = [];
    stream.setTimeout(10_000, () => stream.close(http2.constants.NGHTTP2_CANCEL));
    stream.on('response', (h) => { status = Number(h[':status']) || 0; headers = h as typeof headers; });
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => { session.close(); resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8') }); });
    stream.on('error', (e) => { session.close(); reject(e); });
    stream.end(req.body);
  });
};

/**
 * What became of one device's send.
 *  - sent:           Apple accepted it (200). Acceptance, not display — same caveat as web push.
 *  - invalid-token:  the token is dead for this app (410 Unregistered, 400 BadDeviceToken /
 *                    DeviceTokenNotForTopic): the caller should clear it.
 *  - auth-error:     our provider token was refused (403 Expired/InvalidProviderToken); the cached
 *                    token is dropped so the next send mints a fresh one. Not the device's fault.
 *  - failed:         anything else (429, 5xx, network, payload too large) — leave the token alone.
 *  - not-configured: APNs is off (see apnsConfig) — nothing was sent.
 */
export type ApnsOutcome = 'sent' | 'invalid-token' | 'auth-error' | 'failed' | 'not-configured';

export interface ApnsResult {
  outcome: ApnsOutcome;
  status: number | null;
  /** Apple's `reason` string, when it gave one (e.g. "Unregistered", "BadDeviceToken"). */
  reason: string | null;
}

const INVALID_TOKEN_REASONS = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered']);
const AUTH_REASONS = new Set(['ExpiredProviderToken', 'InvalidProviderToken', 'MissingProviderToken']);

export function classifyApnsResponse(status: number, body: string): ApnsResult {
  let reason: string | null = null;
  try { reason = (JSON.parse(body || '{}') as { reason?: string }).reason ?? null; } catch { /* non-JSON body */ }
  if (status === 200) return { outcome: 'sent', status, reason: null };
  if (status === 410) return { outcome: 'invalid-token', status, reason: reason ?? 'Unregistered' };
  if (status === 400 && reason && INVALID_TOKEN_REASONS.has(reason)) return { outcome: 'invalid-token', status, reason };
  if (status === 403 && reason && AUTH_REASONS.has(reason)) return { outcome: 'auth-error', status, reason };
  return { outcome: 'failed', status, reason };
}

/** Is this a plausible APNs device token (hex, as the devices lib stores it)? */
export const isApnsToken = (t: unknown): t is string => typeof t === 'string' && /^[0-9a-f]{32,200}$/.test(t);

/**
 * Send one notification to one device. Never throws: every outcome is a value.
 * With no configuration it returns `not-configured` and makes no request at all.
 */
export async function sendApns(
  deviceToken: string,
  n: ApnsNotification,
  opts: { config?: ApnsConfig | null; transport?: ApnsTransport; nowSec?: number } = {},
): Promise<ApnsResult> {
  const cfg = opts.config === undefined ? apnsConfig() : opts.config;
  if (!cfg) return { outcome: 'not-configured', status: null, reason: null };
  if (!isApnsToken(deviceToken)) return { outcome: 'invalid-token', status: null, reason: 'MalformedToken' };
  const req = buildApnsRequest(cfg, deviceToken, n, providerToken(cfg, opts.nowSec));
  if (Buffer.byteLength(req.body) > APNS_MAX_BYTES) return { outcome: 'failed', status: null, reason: 'PayloadTooLarge' };
  try {
    const res = await (opts.transport ?? http2Transport)(req);
    const result = classifyApnsResponse(res.status, res.body);
    if (result.outcome === 'auth-error') resetProviderToken();
    return result;
  } catch (err) {
    return { outcome: 'failed', status: null, reason: (err as Error)?.message?.slice(0, 80) ?? 'network' };
  }
}
