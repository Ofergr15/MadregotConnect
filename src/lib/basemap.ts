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
 * The replacement is Esri's Light/Dark Gray Canvas: keyless, unwatermarked, and
 * visually the same muted plate CARTO's `light_all` was picked for — a route
 * line has to pop off it. Attribution is a condition of use, so it travels with
 * the URLs rather than being left to each call site to remember.
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
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';

/**
 * The tile host on its own, for the service worker's bypass rule — map tiles
 * must not be mediated by `defaultCache`'s NetworkFirst, which makes opaque
 * cross-origin responses flaky on mobile. Changing the provider without changing
 * this makes thumbnails intermittent on phones, which is where the feed is read.
 */
export const BASEMAP_HOSTNAME = 'server.arcgisonline.com';

/** Light muted plate. The default: the design system is the light one. */
export const BASEMAP_URL_TEMPLATE = `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`;

/** Same tiles, dark. Only for surfaces that are themselves dark. */
export const BASEMAP_URL_TEMPLATE_DARK = `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`;

/**
 * Deepest zoom these services actually have tiles for. The service metadata
 * advertises levels 0–23, but the raster cache stops at 16 — past that you get a
 * grey "Map data not yet available" tile, which is indistinguishable from a
 * loading failure. Anything that picks its own zoom must clamp to this.
 */
export const BASEMAP_MAX_ZOOM = 16;

/** Required attribution, from the services' own `copyrightText`. */
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
