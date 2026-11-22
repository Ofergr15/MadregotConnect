import { NextResponse } from 'next/server';
import { supabaseBase } from '@/lib/native/supabase-proxy';
import { rateLimited } from '@/lib/onboarding/signup-status';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } });

/**
 * POST /api/native/auth/refresh {refresh_token}
 *
 * Public by necessity (an expired access token is why the caller is here). It only
 * forwards a refresh token the caller already holds to the CONFIGURED Supabase project's
 * GoTrue refresh grant and relays the answer — it grants nothing the caller could not get
 * from Supabase directly with the public anon key. Never logs the body or the tokens.
 */
export async function POST(request: Request) {
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(`native-refresh:${client}`)) {
    return json({ error: 'too-many' }, 429, { 'Retry-After': '60' });
  }

  const body = (await request.json().catch(() => null)) as { refresh_token?: unknown } | null;
  const refreshToken = typeof body?.refresh_token === 'string' ? body.refresh_token.trim() : '';
  if (!refreshToken) return json({ error: 'invalid_request', error_description: 'refresh_token required' }, 400);

  const base = supabaseBase();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !anonKey) return json({ error: 'not-configured' }, 503);

  let upstream: Response;
  try {
    upstream = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
    });
  } catch {
    console.error('[native/auth/refresh] upstream unreachable');
    return json({ error: 'upstream-unavailable' }, 502);
  }

  const data = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;
  if (!upstream.ok) {
    // Relay GoTrue's error shape and status (400/401 = spent/revoked/unknown token).
    const err = data ? { error: data.error ?? data.error_code ?? 'refresh-failed', error_description: data.error_description ?? data.msg } : { error: 'refresh-failed' };
    if (upstream.status >= 500) console.error('[native/auth/refresh] upstream status', upstream.status);
    return json(err, upstream.status);
  }
  if (!data) return json({ error: 'bad-upstream-response' }, 502);

  const { access_token, refresh_token, expires_in, expires_at, token_type, user } = data;
  return json({ access_token, refresh_token, expires_in, expires_at, token_type, user }, 200);
}
