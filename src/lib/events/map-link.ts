/**
 * Reading coordinates out of a pasted map link.
 *
 * Reported as "admin should have the option to add a Google Maps location, and
 * that will be the location of the race". Everything downstream of coordinates
 * already exists: the calendar plots a pin for every event with lat/lng, and the
 * event page shows a navigate button (src/app/(app)/dashboard/calendar/[id],
 * resolveWazeUrl). The only missing link was the input — the staff "add event"
 * sheet collected a free-text location and nothing else, so an event added in the
 * app could never appear on the app's own map.
 *
 * A paste box rather than a map picker, deliberately: staff are already looking at
 * the race in Google Maps when they add it (that is where the race's own site sends
 * them), and "share → copy link → paste" is three taps they already know. An
 * embedded picker would mean shipping a tile-picking UI and asking somebody to
 * re-find a place they had already found.
 *
 * ── The one thing this CANNOT do ──────────────────────────────────────────────
 * A short link (maps.app.goo.gl/…, goo.gl/maps/…) contains no coordinates at all —
 * it is an opaque id that only Google's redirector can expand. Resolving one means
 * a server-side fetch of a third-party URL on staff-supplied input, which is a
 * request-forgery shape not worth adding for a convenience field. So a short link
 * is refused with its OWN reason, and the UI tells the person to open it and copy
 * the full link from the address bar. Refusing loudly beats saving an event whose
 * pin silently landed nowhere.
 */

export interface MapPoint {
  lat: number;
  lng: number;
}

export type MapLinkResult =
  | { ok: true; point: MapPoint }
  /** A short link: real, but unreadable without expanding it. Ask for the full URL. */
  | { ok: false; reason: 'shortLink' }
  /** Not a link this can read coordinates out of. */
  | { ok: false; reason: 'unparsed' };

/** Google's own short domains, plus the generic one it still emits on desktop. */
const SHORT_LINK_RE = /(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i;

/**
 * The place pin, from the `data=` blob: `!3d<lat>!4d<lng>`. Preferred over `@`
 * below, because `@` is the *viewport centre* of whatever the person was looking
 * at — pan the map without moving the pin and the two disagree by kilometres.
 */
const DATA_PIN_RE = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/;

/** `/maps/@32.08,34.78,15z` and `/maps/place/Name/@32.08,34.78,15z`. */
const AT_RE = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;

/**
 * A bare pair, which is what you get from Google Maps' "copy coordinates" and from
 * most race websites. Anchored at both ends so it cannot match two numbers out of
 * the middle of a sentence.
 */
const BARE_PAIR_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/**
 * Query parameters that carry a coordinate pair, in the order Google itself
 * prefers them. `ll` also covers Waze links, so a Waze share works in this box too
 * — the field is about locating the race, not about which app the person used.
 */
const COORD_PARAMS = ['query', 'destination', 'q', 'll', 'center', 'daddr'];

function toPoint(rawLat: string, rawLng: string): MapPoint | null {
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Out-of-range numbers are a mis-parse, not a location. Silently keeping one
  // would put a pin at the edge of the world map and look like a bug in the map.
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // Both exactly zero is the null island — the signature of an empty template, not
  // of a race in the Gulf of Guinea.
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * Pull a coordinate pair out of a pasted Google Maps (or Waze) link.
 *
 * Accepts, in precedence order: the `data=!3d!4d` place pin, a coordinate-bearing
 * query parameter, the `@` viewport centre, and a bare "lat, lng" pair.
 */
export function parseMapLink(input: string): MapLinkResult {
  const value = (input || '').trim();
  if (!value) return { ok: false, reason: 'unparsed' };

  const bare = BARE_PAIR_RE.exec(value);
  if (bare) {
    const point = toPoint(bare[1], bare[2]);
    return point ? { ok: true, point } : { ok: false, reason: 'unparsed' };
  }

  // Checked before the regexes below, because a short link has no coordinates for
  // them to find and "unparsed" would send the person looking for a typo that is
  // not there.
  if (SHORT_LINK_RE.test(value)) return { ok: false, reason: 'shortLink' };

  const dataPin = DATA_PIN_RE.exec(value);
  if (dataPin) {
    const point = toPoint(dataPin[1], dataPin[2]);
    if (point) return { ok: true, point };
  }

  // A URL, if it parses as one. Query params are read through URLSearchParams
  // rather than by regex so that percent-encoding (`%2C` for the comma, which
  // Google emits) is decoded for free.
  let url: URL | null = null;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (url) {
    for (const key of COORD_PARAMS) {
      const raw = url.searchParams.get(key);
      if (!raw) continue;
      const pair = BARE_PAIR_RE.exec(raw);
      if (!pair) continue;
      const point = toPoint(pair[1], pair[2]);
      if (point) return { ok: true, point };
    }
  }

  const at = AT_RE.exec(value);
  if (at) {
    const point = toPoint(at[1], at[2]);
    if (point) return { ok: true, point };
  }

  return { ok: false, reason: 'unparsed' };
}

/**
 * A Google Maps link for a point, for the event page's "open in Maps" button.
 *
 * `search/?api=1&query=` is the documented, app-agnostic form: it opens the native
 * app when one is installed and the web map when it is not, on both platforms.
 * Hand-built `maps://` URLs do neither reliably.
 */
export function googleMapsUrl(point: MapPoint): string {
  return `https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`;
}

/**
 * ── Expanding a short link ───────────────────────────────────────────────────
 * The docblock at the top of this file used to say a short link would simply be
 * refused. Asked for anyway ("add paste support for the shortened link"), which is
 * fair: the share sheet on a phone produces a short link and nothing else, so
 * refusing them refuses the normal way of doing this.
 *
 * It needs one server-side hop, and the ONLY thing that keeps that hop from being
 * a request-forgery hole is this host list. It is a suffix match on the registrable
 * domain, checked again on every redirect in the chain — not once on the input —
 * because a redirect is attacker-controlled input too, and an open redirector on a
 * trusted host is how a one-hop check gets walked to an internal address.
 *
 * Deliberately not configurable and deliberately tiny: three domains Google itself
 * emits. Anything else, including any bare IP or any non-https scheme, fails.
 */
const ALLOWED_MAP_HOSTS = ['goo.gl', 'google.com', 'google.co.il', 'g.co'];

/** Is this a URL the resolver is allowed to fetch? Applied to every hop. */
export function isAllowedMapUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  // Credentials in a URL are never needed here and are a classic way to make a
  // host look like one thing to a reader and another to a fetcher.
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_MAP_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
}

/** Does this look like a link that needs expanding before it can be read? */
export function isShortMapLink(value: string): boolean {
  return SHORT_LINK_RE.test((value || '').trim());
}
