import { NextResponse } from 'next/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { FILES_COOKIE, FILES_COOKIE_OPTIONS, signFilesCookie } from '@/lib/storage/file-access';

export const dynamic = 'force-dynamic';

/**
 * POST /api/files/session — the `mc_files` cookie that lets <img>/<a> tags (which can't send
 * the bearer token) load private-bucket files through /api/files. Verified member only.
 * DELETE clears it (sign-out).
 */
export async function POST(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const value = signFilesCookie(caller.isStaff || caller.isSuperUser ? 'staff' : 'member');
  if (!value) return NextResponse.json({ error: 'File access not configured' }, { status: 500 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(FILES_COOKIE, value, FILES_COOKIE_OPTIONS);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(FILES_COOKIE, '', { ...FILES_COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
