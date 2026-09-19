import { NextResponse } from 'next/server';
import { requireSession, authError } from '@/lib/auth-session';
import { isAllowedMapUrl, isShortMapLink, parseMapLink } from '@/lib/events/map-link';

export const dynamic = 'force-dynamic';

/**
 * POST /api/events/resolve-map-link  { url }  ->  { lat, lng }
 *
 * Expands a Google Maps short link (maps.app.goo.gl/…) far enough to read the
 * coordinates out of it. The phone share sheet emits nothing but short links, and
 * those carry no coordinates at all — only Google's redirector knows where they
 * point — so without this the normal way to share a place could not be pasted.
 *
 * ── What keeps an outbound fetch on caller-supplied input safe ───────────────
 * Four things, and all four matter:
 *
 *  1. STAFF ONLY. Same gate as the POST that creates the event this feeds, so the
 *     route grants nothing its caller did not already have. It is not a general
 *     URL fetcher exposed to the club.
 *  2. HOST ALLOW-LIST, RE-CHECKED EVERY HOP. `isAllowedMapUrl` (lib/events/map-link)
 *     permits https on four Google domains and nothing else — no other host, no
 *     other scheme, no credentials in the URL. Checked on the input AND on every
 *     Location header, because an open redirector on a trusted host is exactly how
 *     a one-hop check gets walked somewhere internal.
 *  3. REDIRECTS ARE READ, NOT FOLLOWED. `redirect: 'manual'` — this reads the
 *     Location header itself rather than letting fetch chase it, which is the only
 *     way to apply (2) to each hop. Capped at MAX_HOPS.
 *  4. THE BODY IS NEVER READ. The answer is in the redirect target; the response
 *     body is dropped unread, so there is no parsing of a third party's HTML and no
 *     way for a large or slow body to tie up the server.
 *
 * The caller's URL is never echoed back, and neither is the resolved Google URL —
 * only the two numbers. Failures are a reason code, so the sheet can say something
 * useful without repeating an attacker-supplied string into the UI.
 */

const MAX_HOPS = 5;
const FETCH_TIMEOUT_MS = 6000;

export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }

  let url: string;
  try {
    const body = await request.json();
    url = typeof body?.url === 'string' ? body.url.trim() : '';
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!url || !isShortMapLink(url) || !isAllowedMapUrl(url)) {
    return NextResponse.json({ error: 'unsupported_link' }, { status: 400 });
  }

  try {
    let current = url;

    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        // Google serves a coordinate-bearing redirect to a browser and a consent
        // interstitial to an unrecognised client, so the UA is load-bearing here.
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/605.1.15',
          'Accept-Language': 'en',
        },
      });

      const location = res.headers.get('location');
      if (!location) break;

      // Relative Location headers are legal, so resolve against the current URL
      // before the allow-list sees it — otherwise a relative hop looks like a
      // malformed absolute URL and gets refused for the wrong reason.
      const next = new URL(location, current).toString();
      if (!isAllowedMapUrl(next)) {
        return NextResponse.json({ error: 'unsupported_link' }, { status: 400 });
      }

      // Every hop is a candidate: the coordinates usually appear on the first
      // redirect, and stopping there avoids the consent page later in the chain.
      const parsed = parseMapLink(next);
      if (parsed.ok) {
        return NextResponse.json({ lat: parsed.point.lat, lng: parsed.point.lng });
      }
      current = next;
    }

    // Resolved to something real that still has no coordinates in it — a place
    // page without a pin, or a consent wall. Say so plainly; the sheet asks for
    // the full link instead.
    return NextResponse.json({ error: 'not_found' }, { status: 422 });
  } catch (error) {
    // A timeout or a network failure is not the person's fault and not a bad
    // link, so it must not be reported as one.
    console.error('Failed to resolve map short link:', error);
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}
