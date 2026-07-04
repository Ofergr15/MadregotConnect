import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  if (!request.cookies.get('NEXT_LOCALE')) {
    const acceptLanguage = request.headers.get('accept-language') || '';
    const prefersHebrew = acceptLanguage.includes('he');
    const preferredLocale = prefersHebrew || !acceptLanguage.includes('en') ? 'he' : 'en';

    response.cookies.set('NEXT_LOCALE', preferredLocale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next|images|.*\\..*).*)'],
};
