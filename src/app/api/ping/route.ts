/**
 * Is the server reachable? Nothing else.
 *
 * Exists for /offline.html, which has to answer that question before it reloads.
 * A reload that fails goes straight back to the offline screen, so the page needs
 * evidence rather than optimism — and `navigator.onLine` is not evidence: both
 * phones that reported the offline screen on 2026-09-08/09 had a live connection
 * and would have reported `true`.
 *
 * Deliberately touches no database and reads no session: a reachability probe that
 * can fail for a second reason cannot answer the first question. It is also the
 * one route shape the service worker guarantees hits the network — /api/* is
 * NetworkOnly there (src/app/sw.ts), so a cached 204 can never fake a recovery.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
