import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isDevApiRequestAllowed, isDevSurface } from '@/lib/dev-api-allowlist';

/** Paths the original page matcher skipped: assets, files, the service worker. */
const isAssetPath = (p: string) =>
  p.startsWith('/_next/') || p.startsWith('/serwist/') || p.startsWith('/images/') || /\.[^/]*$/.test(p.split('/').pop() ?? '');

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // The dev surface (lib/dev-api-allowlist.ts) serves EXACTLY the seven allowlisted
  // method + path pairs and nothing else: every web page, _next asset, image, public
  // file and every other API route answers 404. Flag unset there ⇒ all 404 (fail closed).
  // Production, other previews and local dev never take this branch.
  if (isDevSurface()) {
    return isDevApiRequestAllowed(request.method, pathname)
      ? NextResponse.next()
      : new NextResponse(null, { status: 404 });
  }

  // Everywhere else: exactly as before. API requests pass straight through, and so do
  // assets reached only through the vercel.app matcher below.
  if (pathname === '/api' || pathname.startsWith('/api/') || isAssetPath(pathname)) return NextResponse.next();

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

/**
 * *.vercel.app hosts (previews and deployment URLs); never the production domain. Next
 * anchors it (^…$) and compares it to the lowercased host without its port.
 */
export const VERCEL_APP_HOST = '(?:.+\\.)?vercel\\.app';

export const config = {
  matcher: [
    '/((?!api|serwist|_next|images|.*\\..*).*)',
    '/api/:path*',
    // Every path — assets, images, public files included — on *.vercel.app hosts only,
    // so the dev surface can close all of it. The production domain (madregot.app) never
    // matches this entry, so production assets still skip the proxy entirely.
    // (A literal on purpose: Next reads the matcher statically and ignores variables.
    // devApiAllowlist.test.ts pins it equal to VERCEL_APP_HOST.)
    { source: '/:path*', has: [{ type: 'host', value: '(?:.+\\.)?vercel\\.app' }] },
  ],
};
