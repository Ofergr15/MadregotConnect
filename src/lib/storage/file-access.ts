import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { createServerClient } from '@/lib/supabase/server';
import { type BucketAccess, type BucketName, rewriteStorageUrls, servedObject } from '@/lib/storage/buckets';

/**
 * Reading a private bucket (lib/storage/buckets.ts) through GET /api/files/<bucket>/<path>.
 *
 * Who may: a verified member, by either of two credentials —
 *   • the bearer token, for fetch() and the native app;
 *   • the httpOnly `mc_files` cookie, for <img>/<a>/<iframe>: a tag can't send the bearer
 *     token, and that is how every avatar, feed photo and PDF in the app is loaded. It is
 *     minted only against a verified session (POST /api/files/session, and the login's
 *     /api/auth/device-token) and says nothing but "member" or "staff" until it expires.
 * Then a 302 to a ten-minute signed URL.
 */
export const FILES_COOKIE = 'mc_files';
const LABEL = 'files-cookie-v1';
export const FILES_COOKIE_TTL_S = 60 * 60 * 24 * 7;
export const SIGNED_URL_TTL_S = 600;

export const FILES_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api/files',
  maxAge: FILES_COOKIE_TTL_S,
};

function mac(body: string): string | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) return null;
  return createHmac('sha256', `${LABEL}:${key}`).update(body).digest('base64url');
}

/** `<exp>.<m|s>.<sig>`; null when ENCRYPTION_KEY is unusable. */
export function signFilesCookie(level: BucketAccess, nowMs = Date.now()): string | null {
  const body = `${Math.floor(nowMs / 1000) + FILES_COOKIE_TTL_S}.${level === 'staff' ? 's' : 'm'}`;
  const sig = mac(body);
  return sig ? `${body}.${sig}` : null;
}

export function verifyFilesCookie(value: string | null | undefined, nowMs = Date.now()): BucketAccess | null {
  const m = /^(\d{9,11})\.([ms])\.([A-Za-z0-9_-]{20,})$/.exec(value || '');
  if (!m || Number(m[1]) < Math.floor(nowMs / 1000)) return null;
  const want = mac(`${m[1]}.${m[2]}`);
  if (!want || want.length !== m[3].length || !timingSafeEqual(Buffer.from(want), Buffer.from(m[3]))) return null;
  return m[2] === 's' ? 'staff' : 'member';
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** The caller's level for files: bearer first (it is checked live), then the cookie. */
async function callerLevel(request: Request): Promise<{ level: BucketAccess | null; denied: Response | null }> {
  if (request.headers.get('authorization')) {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return { level: null, denied };
    return { level: caller.isStaff || caller.isSuperUser ? 'staff' : 'member', denied: null };
  }
  const level = verifyFilesCookie(cookieValue(request, FILES_COOKIE));
  return level ? { level, denied: null } : { level: null, denied: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
}

// Signing is a storage round trip; a feed of 30 avatars would pay it 30 times per view.
// A signed URL is reused for most of its life (per server instance).
const signedCache = new Map<string, { url: string; until: number }>();

async function signedUrl(bucket: BucketName, path: string, ttlS: number): Promise<string | null> {
  const key = `${bucket}/${path}/${ttlS}`;
  const now = Date.now();
  const hit = signedCache.get(key);
  if (hit && hit.until > now) return hit.url;
  const { data, error } = await createServerClient().storage.from(bucket).createSignedUrl(path, ttlS);
  if (error || !data?.signedUrl) return null;
  if (signedCache.size > 2000) signedCache.clear();
  signedCache.set(key, { url: data.signedUrl, until: now + ttlS * 1000 * 0.6 });
  return data.signedUrl;
}

/** GET /api/files/<bucket>/<...path> */
export async function serveFile(request: Request, bucket: string, segments: readonly string[] | undefined): Promise<Response> {
  const object = servedObject(bucket, segments);
  if (!object) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const { level, denied } = await callerLevel(request);
  if (denied || !level) return denied ?? NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (object.access === 'staff' && level !== 'staff') return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  const url = await signedUrl(object.bucket, object.path, SIGNED_URL_TTL_S);
  if (!url) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  // The browser may reuse the redirect for a few minutes (the signed URL outlives it).
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, max-age=300' } });
}

/**
 * A link into a served bucket as a signed absolute URL valid for a week — for whoever
 * fetches it outside the page without the cookie: a push `icon`/`image` (the browser/OS,
 * possibly days later) and the move checks. Anything else is returned as it came; a
 * malformed or staff-only link is dropped.
 */
export async function signedLinkFor(url: string | undefined): Promise<string | undefined> {
  if (!url) return url;
  const route = rewriteStorageUrls(url);
  const m = /^(?:https?:\/\/[^/]+)?\/api\/files\/([^/?#]+)\/([^?#]+)/.exec(route);
  if (!m) return url;
  let segments: string[];
  try {
    segments = m[2].split('/').map(decodeURIComponent);
  } catch {
    return undefined;
  }
  const object = servedObject(m[1], segments);
  if (!object || object.access !== 'member') return undefined;
  return (await signedUrl(object.bucket, object.path, 60 * 60 * 24 * 7)) ?? undefined;
}
