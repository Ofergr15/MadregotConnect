import { NextResponse } from 'next/server';
import { requireSession, authError } from '@/lib/auth-session';
import {
  extractPlaceQuery,
  geocodeCandidates,
  isAllowedMapUrl,
  isShortMapLink,
  parseMapLink,
  type MapPoint,
} from '@/lib/events/map-link';

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

/**
 * Geocoding, for the case above where the link names a place instead of pointing at
 * one.
 *
 * Nominatim (OpenStreetMap) rather than Google's Geocoding API: the app is already
 * drawn on OSM tiles and already carries OSM's attribution on the calendar map, so
 * no new data source and no new credit line — and the Geocoding API needs a billed
 * key this app does not have.
 *
 * Its usage policy is the reason for the shape of this: an identifying User-Agent,
 * at most three queries per paste (geocodeCandidates caps that), tried in sequence
 * and stopped at the first hit, and only ever on a staff action. This is single
 * digits of requests per month, not a crawl.
 */
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const GEOCODER_UA = 'MadregotConnect/1.0 (running club calendar; https://www.madregot.app)';

async function geocodePlace(place: string): Promise<MapPoint | null> {
  for (const query of geocodeCandidates(place)) {
    try {
      const url = new URL(NOMINATIM_URL);
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '1');
      url.searchParams.set('q', query);

      const res = await fetch(url, {
        headers: { 'User-Agent': GEOCODER_UA, 'Accept-Language': 'he,en' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) continue;

      const hits = await res.json();
      const first = Array.isArray(hits) ? hits[0] : null;
      if (!first) continue;

      // Nominatim returns lat/lon as STRINGS, and calls longitude `lon`.
      const lat = Number(first.lat);
      const lng = Number(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      return { lat, lng };
    } catch {
      // A failed candidate is not a failed geocode — try the next, looser one.
      continue;
    }
  }
  return null;
}

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

    // ── No coordinates in the chain, which is the NORMAL case ────────────────
    // Measured against a real iPhone share: the short link redirects to
    // `maps.google.com?q=<name>, <street>, <city>` and nothing in the chain (or in
    // the 800 KB page at the end) holds a lat/lng. What it does hold is the place.
    // Turning a place into a point is geocoding, so that is what happens here.
    const place = extractPlaceQuery(current);
    if (place) {
      const point = await geocodePlace(place);
      // The place name goes back either way. Without coordinates there is no map
      // pin — but the name is still the useful half, and the sheet offers it as the
      // event's location text rather than making somebody retype what they pasted.
      return NextResponse.json(point ? { ...point, place } : { place, error: 'no_coords' }, {
        status: point ? 200 : 422,
      });
    }

    // Resolved to something real with neither coordinates nor a place in it — a
    // consent wall, most likely. Say so plainly; the sheet asks for the full link.
    return NextResponse.json({ error: 'not_found' }, { status: 422 });
  } catch (error) {
    // A timeout or a network failure is not the person's fault and not a bad
    // link, so it must not be reported as one.
    console.error('Failed to resolve map short link:', error);
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}
