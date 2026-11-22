import { createPrivateKey, sign, type KeyObject } from 'crypto';
import http2 from 'http2';

/**
 * Apple Push Notification service sender for the native iOS app (bundle
 * app.madregot.ios) — HTTP/2, token-based (.p8) auth.
 *
 * The keys come ONLY from env vars the owner sets in Vercel:
 *   APNS_KEY_ID   — the 10-char Key ID of the APNs auth key
 *   APNS_TEAM_ID  — the Apple Developer Team ID
 *   APNS_KEY_P8   — the .p8 file's contents (PEM; literal "\n" escapes are accepted)
 *   APNS_ENV      — "production" (TestFlight / App Store, the default) or "sandbox" (Xcode debug builds)
 *   APNS_BUNDLE_ID — optional, defaults to app.madregot.ios
 *
 * Any of the first three missing ⇒ `apnsConfig()` is null and every caller skips
 * APNs silently. Nothing here may throw into the send path: web-push must never
 * be blocked by Apple.
 */

export const DEFAULT_APNS_BUNDLE_ID = 'app.madregot.ios';
const HOSTS = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' } as const;

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  key: KeyObject;
  bundleId: string;
  host: string;
}

let cachedConfig: { sig: string; value: ApnsConfig | null } | null = null;

export function apnsConfig(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  const p8 = env.APNS_KEY_P8?.trim();
  if (!keyId || !teamId || !p8) return null;
  const mode = (env.APNS_ENV || 'production').trim().toLowerCase();
  const host = mode === 'sandbox' || mode === 'development' ? HOSTS.sandbox : HOSTS.production;
  const bundleId = env.APNS_BUNDLE_ID?.trim() || DEFAULT_APNS_BUNDLE_ID;
  const sig = `${keyId}|${teamId}|${host}|${bundleId}|${p8.length}|${p8.slice(-16)}`;
  if (cachedConfig?.sig === sig) return cachedConfig.value;
  let value: ApnsConfig | null = null;
  try {
    const pem = p8.includes('\\n') ? p8.replace(/\\n/g, '\n') : p8;
    value = { keyId, teamId, key: createPrivateKey(pem), bundleId, host };
  } catch {
    console.warn('[apns] APNS_KEY_P8 could not be read as a private key — APNs disabled');
  }
  cachedConfig = { sig, value };
  return value;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** The provider token (ES256 JWT). Apple accepts one for up to an hour and rejects refreshing more than every 20 min. */
export function providerToken(cfg: Pick<ApnsConfig, 'keyId' | 'teamId' | 'key'>, nowSec = Math.floor(Date.now() / 1000)): string {
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: nowSec }));
  const signature = sign('sha256', Buffer.from(`${head}.${claims}`), { key: cfg.key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${claims}.${b64url(signature)}`;
}

let tokenCache: { keyId: string; teamId: string; token: string; at: number } | null = null;
function cachedToken(cfg: ApnsConfig, nowSec: number): string {
  if (tokenCache && tokenCache.keyId === cfg.keyId && tokenCache.teamId === cfg.teamId && nowSec - tokenCache.at < 40 * 60) {
    return tokenCache.token;
  }
  const token = providerToken(cfg, nowSec);
  tokenCache = { keyId: cfg.keyId, teamId: cfg.teamId, token, at: nowSec };
  return token;
}

/** The fields of a PushPayload the APNs body is built from (kept structural so push.ts owns the type). */
export interface ApnsSource {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  kind?: string;
  category?: string;
}

/**
 * The APNs JSON body. `url` sits at the TOP LEVEL of userInfo — exactly where
 * PushTap.url(from:) (ios/Madregot/Features/NotificationArea/PushTap.swift) reads it.
 */
export function buildApnsPayload(
  p: ApnsSource,
  extra: { nid: string; badge: number; athleteId: string },
): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    alert: { title: p.title, body: p.body },
    badge: extra.badge,
    sound: 'default',
  };
  if (p.tag) aps['thread-id'] = p.tag;
  return {
    aps,
    ...(p.url ? { url: p.url } : {}),
    nid: extra.nid,
    athleteId: extra.athleteId,
    ...(p.kind ?? p.category ? { kind: p.kind ?? p.category } : {}),
  };
}

export interface ApnsResult {
  ok: boolean;
  status: number;
  reason: string | null;
  /** 410 Unregistered: the token is gone for good and should be cleared. */
  dead: boolean;
}

export interface ApnsRequest {
  host: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}
export type ApnsTransport = (req: ApnsRequest) => Promise<{ status: number; body: string }>;

// One HTTP/2 connection per warm instance, as Apple asks; dropped on any error/close.
let session: http2.ClientHttp2Session | null = null;
let sessionHost = '';
function getSession(host: string): http2.ClientHttp2Session {
  if (session && !session.closed && !session.destroyed && sessionHost === host) return session;
  try { session?.close(); } catch { /* ignore */ }
  const s = http2.connect(host);
  s.on('error', () => { if (session === s) session = null; });
  s.on('close', () => { if (session === s) session = null; });
  s.on('goaway', () => { if (session === s) session = null; });
  s.unref();
  session = s;
  sessionHost = host;
  return s;
}

const http2Transport: ApnsTransport = (req) =>
  new Promise((resolve, reject) => {
    let s: http2.ClientHttp2Session;
    try { s = getSession(req.host); } catch (e) { reject(e); return; }
    const stream = s.request({ ':method': 'POST', ':path': req.path, ...req.headers });
    let status = 0;
    let data = '';
    const timer = setTimeout(() => { stream.close(http2.constants.NGHTTP2_CANCEL); reject(new Error('timeout')); }, 10_000);
    stream.setEncoding('utf8');
    stream.on('response', (h) => { status = Number(h[':status']) || 0; });
    stream.on('data', (c: string) => { data += c; });
    stream.on('end', () => { clearTimeout(timer); resolve({ status, body: data }); });
    stream.on('error', (e) => { clearTimeout(timer); reject(e); });
    stream.end(req.body);
  });

/** Send one notification to one device token. Never throws. */
export async function sendApns(
  cfg: ApnsConfig,
  deviceToken: string,
  payload: Record<string, unknown>,
  opts: { collapseId?: string; transport?: ApnsTransport; nowSec?: number } = {},
): Promise<ApnsResult> {
  try {
    const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = {
      authorization: `bearer ${cachedToken(cfg, nowSec)}`,
      'apns-topic': cfg.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    };
    if (opts.collapseId && Buffer.byteLength(opts.collapseId) <= 64) headers['apns-collapse-id'] = opts.collapseId;
    const res = await (opts.transport ?? http2Transport)({
      host: cfg.host,
      path: `/3/device/${deviceToken}`,
      headers,
      body: JSON.stringify(payload),
    });
    if (res.status === 200) return { ok: true, status: 200, reason: null, dead: false };
    let reason: string | null = null;
    try { reason = (JSON.parse(res.body) as { reason?: string }).reason ?? null; } catch { /* empty body */ }
    // A rejected provider token must not be reused for the next device.
    if (res.status === 403) tokenCache = null;
    return { ok: false, status: res.status, reason, dead: res.status === 410 };
  } catch (e) {
    return { ok: false, status: 0, reason: String((e as Error)?.message ?? 'error').slice(0, 60), dead: false };
  }
}
