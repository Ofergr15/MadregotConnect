import { AASA } from '@/lib/apple/aasa';

// Apple fetches this exact path (no extension) and requires 200 + JSON, no redirect.
// The proxy matcher skips any path containing a dot, so /.well-known never reaches it.
export const dynamic = 'force-static';

export function GET() {
  return new Response(JSON.stringify(AASA), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
}
