import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
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
  matcher: ['/((?!api|serwist|_next|images|.*\\..*).*)'],
};
