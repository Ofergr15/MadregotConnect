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
 * The route basemap: the pale canvas plate, which is what a run should be drawn
 * on at the zooms anybody actually looks at.
 *
 * ── The history, because this constant has now been both things ──────────────
 *
 * It was `World_Street_Map` with a desaturating filter over it, on the theory
 * that "Strava's map isn't a different provider, it's this same kind of map with
 * the colour taken out". That theory was wrong, and 15046ef2 said so from a
 * phone: *"the map uses Garmin's map; on Strava it looks better"*. Two things
 * were going on.
 *
 *  1. **The Garmin part is the attribution line.** `BASEMAP_ATTRIBUTION` credits
 *     "Esri, HERE, Garmin, © OpenStreetMap contributors" — Garmin is one of
 *     Esri's data suppliers, and reading that under a route map is a perfectly
 *     reasonable way to conclude the app draws Garmin's map. Nothing to fix; it
 *     is a required credit. Worth knowing before redesigning a map over it.
 *  2. **Desaturation was the wrong instrument.** What separates Strava's plate
 *     from a navigation plate is not colour, it is DENSITY, and greyscale cannot
 *     remove a label. Measured on one real Esri street tile over Tel Aviv at
 *     z16: every building footprint drawn, and every street labelled *twice* —
 *     Latin and Hebrew, one above the other. Faded, that is still a page of
 *     text with a line on it.
 *
 * `Canvas/World_Light_Gray_Base` is the same keyless host and is the plate the
 * street map is a fallback FOR: pale paper, thin white roads, buildings as a
 * barely-there tint, and labels once, in one language. No filter — it is already
 * quiet, and desaturating it further only makes it muddy (same reason the dark
 * plate is left alone).
 *
 * The ⚠️ that sent the last redesign the other way is real and still applies:
 * this cache **stops at z16** (verified again — z17 answers 200 with the same
 * 2,521-byte "Map data not yet available" placeholder). Leaflet takes a map's
 * ceiling from its tile layer, so on its own this plate greys out `+` two or
 * three steps in from a fitted 5 km loop, which reads as a broken map. That is
 * what `BASEMAP_URL_TEMPLATE_DEEP` below is for, and why the two are separate
 * constants rather than a choice.
 */
export const BASEMAP_URL_TEMPLATE = `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`;

/**
 * The plate for z17 and deeper, where the canvas has no tiles.
 *
 * `World_Street_Map` runs to z19 and has the detail that makes a deliberate deep
 * zoom worth doing — which side of the road a lap was run on, the name of the
 * park path. Its density is the whole reason it isn't the default, and it is
 * also the reason it is fine here: somebody who has pinched past z16 is asking
 * for exactly that.
 *
 * Drawn at full strength. The desaturating filter was a way to make this plate
 * bearable as a DEFAULT; at z17+ it is chosen, not endured.
 */
export const BASEMAP_URL_TEMPLATE_DEEP = `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`;

/**
 * Last zoom the canvas plate has tiles for — and therefore the handover point.
 * A layer capped here plus a deep layer starting at `+ 1` is the whole mechanism;
 * anything that renders its own single plate (the feed thumbnail) should just
 * clamp to this and never reach for the street map at all.
 */
export const BASEMAP_QUIET_MAX_ZOOM = 16;

/** Dark muted plate. Only for surfaces that are themselves dark (the race map). */
export const BASEMAP_URL_TEMPLATE_DARK = `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`;

// ── NO TILE FILTER ANY MORE, and the measurement that means you shouldn't add
//    one back casually ──────────────────────────────────────────────────────
//
// Both plates above are used as their designers drew them. There used to be a
// `BASEMAP_QUIET_FILTER` (`grayscale(.85) brightness(1.06) contrast(.93)`) over
// the street plate, plus an SVG-primitive twin of it for the feed thumbnail,
// and 15046ef2 retired both: the canvas plate is already quiet, and the street
// plate is now only ever reached by somebody who pinched past z16 and wants the
// detail.
//
// ⚠️ If a filter is ever needed again, it needs TWO implementations, not one.
// Safari silently ignores CSS `filter` on an inner SVG element. Measured mean
// saturation of one real Esri street tile, rendered and screenshotted in both
// engines:
//
//            raw     CSS filter        SVG filter
//   Chromium 0.171   0.022  works      0.024  works
//   WebKit   0.171   0.171  IGNORED    0.026  works
//
// That bug shipped once: every feed thumbnail on every iPhone drew the
// navigation plate at full strength while looking correct in desktop Chrome. A
// Leaflet <div> honours CSS filters, an inner <image> does not. And an SVG
// filter needs `color-interpolation-filters="sRGB"` — the default is linearRGB,
// which darkens the midtones and will not match the CSS version.

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
