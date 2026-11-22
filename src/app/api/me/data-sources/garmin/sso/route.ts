import { NextResponse } from 'next/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { APP_URL } from '@/lib/constants';
import { NATIVE_SCHEME, garminNativeServiceUrl, garminSsoSignInUrl } from '@/lib/data-sources/native';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/data-sources/garmin/sso — where the app's ASWebAuthenticationSession
 * opens. The service URL is fixed by the server (APP_URL) so the ticket exchange
 * below uses exactly the same string; the client never chooses it.
 */
export async function GET(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  return NextResponse.json({
    signInUrl: garminSsoSignInUrl(garminNativeServiceUrl(APP_URL)),
    callbackScheme: NATIVE_SCHEME,
  });
}
