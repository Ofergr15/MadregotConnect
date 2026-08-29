import { NextRequest, NextResponse } from 'next/server';
import { requireSession, authError } from '@/lib/auth-session';
import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, signDeviceToken } from '@/lib/auth/device-token';

export const dynamic = 'force-dynamic';

// POST /api/auth/device-token — issues the httpOnly device cookie that
// /api/auth/silent-session requires.
//
// Gated on a real Supabase JWT, so the only way to obtain the cookie is to
// already hold a genuine session. Called from /auth/resolve (every real login
// funnels through it) and from the admin password login once it mints a session.
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);

  const token = signDeviceToken(auth.user.email);
  if (!token) {
    // Missing/short ENCRYPTION_KEY. Nothing the client can do; say so plainly
    // rather than pretending the cookie was set.
    return NextResponse.json({ error: 'Device tokens not configured' }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(DEVICE_COOKIE, token, DEVICE_COOKIE_OPTIONS);
  return response;
}
