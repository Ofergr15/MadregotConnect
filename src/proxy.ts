import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isDevApiRequestAllowed, isDevSurface } from '@/lib/dev-api-allowlist';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    // Fail closed on the dev deployment only (see lib/dev-api-allowlist.ts); everywhere
    // else — production included — API requests pass straight through, untouched.
    if (!isDevSurface()) return NextResponse.next();
    return isDevApiRequestAllowed(request.method, pathname)
      ? NextResponse.next()
      : new NextResponse(null, { status: 404 });
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
