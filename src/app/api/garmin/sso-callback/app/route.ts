import { NextRequest, NextResponse } from 'next/server';
import { NATIVE_GARMIN_RETURN } from '@/lib/data-sources/native';

/**
 * Garmin SSO → the native app. Garmin redirects here with `?ticket=` (this URL is
 * the `service=` the app's sign-in sheet was opened with); we bounce to the app's
 * scheme, which ASWebAuthenticationSession captures and closes on. The ticket is
 * single-use, short-lived and useless without our exchange — and the exchange is
 * self-only behind the JWT. Not logged.
 */
export async function GET(req: NextRequest) {
  const ticket = req.nextUrl.searchParams.get('ticket') || '';
  const target = ticket
    ? `${NATIVE_GARMIN_RETURN}?ticket=${encodeURIComponent(ticket)}`
    : `${NATIVE_GARMIN_RETURN}?error=no_ticket`;
  return NextResponse.redirect(target);
}
