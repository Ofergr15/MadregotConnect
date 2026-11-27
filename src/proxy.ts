import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isDevApiRequestAllowed, isDevSurface } from '@/lib/dev-api-allowlist';
import { REQUEST_ID_HEADER, requestIdOf } from '@/lib/observability/request-id';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    // Fail closed on the dev deployment only (see lib/dev-api-allowlist.ts); everywhere
    // else — production included — API requests pass straight through, untouched.
    // Every API request carries one id from here on (lib/observability/request-id.ts):
    // forwarded to the route on the request headers, echoed on the response.
    const requestId = requestIdOf(request);
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    const pass = () => {
      const res = NextResponse.next({ request: { headers } });
      res.headers.set(REQUEST_ID_HEADER, requestId);
      return res;
    };
    if (!isDevSurface()) return pass();
    return isDevApiRequestAllowed(request.method, pathname)
      ? pass()
      : new NextResponse(null, { status: 404, headers: { [REQUEST_ID_HEADER]: requestId } });
  }

  const response = NextResponse.next();

  // Hebrew for everyone by default — English is opt-in via the LocaleSwitcher.
  // (Previously sniffed Accept-Language, which gave English-browser members an
  // English app on first visit.)
  if (!request.cookies.get('NEXT_LOCALE')) {
    response.cookies.set('NEXT_LOCALE', 'he', {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|serwist|_next|images|.*\\..*).*)', '/api/:path*'],
};
