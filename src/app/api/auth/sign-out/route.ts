import { NextResponse } from 'next/server';
import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS } from '@/lib/auth/device-token';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/sign-out — forget this browser.
 *
 * The one thing signing out could not do for itself. `supabase.auth.signOut()`
 * clears the session out of localStorage, but the device cookie is httpOnly, so
 * no client can touch it — and it is signed proof that this browser once logged
 * in, valid for a YEAR. Four routes set it and nothing ever deleted it.
 *
 * So sign-out was cosmetic: it dropped the session, sent them to '/', and the
 * landing page's own recovery immediately called /api/auth/silent-session, which
 * read the surviving cookie, minted a fresh session and redirected straight back
 * to /auth/resolve. From the outside the screen flashed and they were still in.
 * (That recovery is right and stays — a Supabase session is lost routinely, and
 * re-minting it is what stops the club being asked to log in every other day.
 * The cookie just has to actually go when somebody asks to leave.)
 *
 * No identity needed, and none is trusted: this only ever deletes the caller's
 * own cookie, so the worst anyone can do with it is sign themselves out.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  // Cleared by writing an already-expired cookie rather than with .delete(), so
  // the path matches what set it byte for byte. A '/'-scoped cookie deleted at a
  // different path silently survives.
  response.cookies.set(DEVICE_COOKIE, '', { ...DEVICE_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
