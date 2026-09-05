/**
 * The one place the app's map tile provider is named.
 *
 * ⚠️ Why this file exists: every map in the app used to hardcode
 * `basemaps.cartocdn.com`, and CARTO has since made an API key mandatory. It
 * doesn't fail loudly — it still answers 200 with a real-looking map that has
 * "API KEY REQUIRED · carto.com/basemaps/apikey" stamped diagonally across every
 * tile. So the calendar map had been quietly serving watermarked tiles, and
 * nothing in a test or a build would ever have said so.
 *
 * The provider is Esri's ArcGIS Online basemaps: keyless, unwatermarked, and
 * attribution is a condition of use, so it travels with the URLs rather than
 * being left to each call site to remember.
 *
 * If a map ever renders as flat grey with a diagonal watermark, or as
 * "Map data not yet available", look here first.
 */

/**
 * ⚠️ Esri orders the path `{z}/{y}/{x}` — row before column, the reverse of the
 * usual XYZ convention. Swapping them looks plausible and lands you on the other
 * side of the planet, so `tileUrl()` in `lib/activity/tiles.ts` and the Leaflet
 * templates below are the only places that should ever write it out.
 */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

/**
 * The tile host on its own, for the service worker's bypass rule — map tiles
 * must not be mediated by `defaultCache`'s NetworkFirst, which makes opaque
 * cross-origin responses flaky on mobile. Changing the provider without changing
 * this makes thumbnails intermittent on phones, which is where the feed is read.
 */
export const BASEMAP_HOSTNAME = 'server.arcgisonline.com';

/**
 * The route basemap: a real street map, the default everywhere a run is drawn.
 *
 * ⚠️ This was `Canvas/World_Light_Gray_Base`, a near-blank grey plate, and that
 * choice is what made the route map feel broken rather than muted:
 *
 *  - **It could not zoom in.** The gray canvas raster cache stops at z16
 *    (verified: z17+ answers 200 with the same 2,521-byte "Map data not yet
 *    available" placeholder). Leaflet takes the map's max zoom from its tile
 *    layer, so `+` greyed out two or three steps in from a fitted 5 km loop —
 *    which reads exactly like a broken map, not a provider limit.
 *  - **There was nothing to zoom to.** The gray canvas has no street names and
 *    almost no detail, so a route was a line on nothing. Strava's appeal is
 *    seeing *which* streets and parks you ran through.
 *
 * `World_Street_Map` is the same keyless host, has real streets/paths/labels,
 * and its cache runs to z19 (z20+ returns the placeholder) — deep enough to see
 * which side of the road a lap was run on.
 */
export const BASEMAP_URL_TEMPLATE = `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`;

/** Dark muted plate. Only for surfaces that are themselves dark (the race map). */
export const BASEMAP_URL_TEMPLATE_DARK = `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`;

/**
 * Turns the street plate down so the route is the loudest thing on it.
 *
 * `World_Street_Map` is a *navigation* basemap: orange motorway casings, yellow
 * arterials, coloured landuse. Drawn full strength behind a 5px line it competes
 * with the run — the reader's eye has to hunt for the route on a map that is
 * shouting about roads. Strava's map isn't a different provider, it's this same
 * kind of map with the colour taken out; that's the whole trick.
 *
 * Applied to the tiles only, never to the route layer — that's the point: the
 * line and its start/end markers stay fully saturated against near-white paper.
 *
 * ⚠️ `grayscale(.85)`, not `1`. The last 15% of colour is what keeps the
 * Mediterranean blue and the parks green, and on this coastline the sea is the
 * strongest orientation cue a Tel Aviv runner has — mono tiles make the coast
 * read as just another grey field. `brightness`/`contrast` lift the paper back up
 * after desaturation, which otherwise leaves it muddy rather than light.
 *
 * Chosen by rendering six candidate recipes over the real tiles at both zooms
 * the app uses (z13 for the feed thumbnail, z16 for the detail map) and looking
 * at them, because "quiet enough but still legible" isn't a thing you can assert.
 *
 * Not for the dark plate: `World_Dark_Gray_Base` is already muted, and lifting
 * its brightness would wash out a map that is meant to sit on a dark surface.
 */
export const BASEMAP_QUIET_FILTER = 'grayscale(.85) brightness(1.06) contrast(.93)';

/**
 * Deepest zoom the street plate actually has tiles for. Service metadata
 * advertises levels 0–23, but the raster cache stops at 19 — past that you get a
 * grey "Map data not yet available" tile, which is indistinguishable from a
 * loading failure. Anything that picks its own zoom must clamp to this.
 */
export const BASEMAP_MAX_ZOOM = 19;

/**
 * The dark canvas is a different cache and a shallower one: it stops at 16.
 * Handing it `BASEMAP_MAX_ZOOM` would let the race map zoom three levels past
 * its own tiles, so the two limits are separate constants on purpose.
 */
export const BASEMAP_MAX_ZOOM_DARK = 16;

/**
 * Required attribution, shortened from the services' own `copyrightText` (both
 * plates list Esri, HERE, Garmin and OpenStreetMap contributors among others).
 */
export const BASEMAP_ATTRIBUTION =
  'Esri, HERE, Garmin, © OpenStreetMap contributors';

/** Builds a single tile URL from a template, in Esri's y/x order. */
export function fillTileTemplate(
  template: string,
  zoom: number,
  x: number,
  y: number,
): string {
  return template
    .replace('{z}', String(zoom))
    .replace('{y}', String(y))
    .replace('{x}', String(x));
}
