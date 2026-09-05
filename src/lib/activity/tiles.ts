/**
 * Web Mercator + raster-tile arithmetic for drawing a route on a real basemap
 * without shipping a mapping library.
 *
 * The feed's route thumbnails used to be a line on a flat rectangle — no map at
 * all — because a Leaflet instance per card is out of the question on a page of
 * 20 runs. This does the small part of what Leaflet does that a thumbnail needs:
 * pick a zoom, work out which 256px tiles cover the box, and project the route
 * into the same pixel space so the line lands on the streets it was run on.
 *
 * Everything here is pure and framework-free so it can be unit-tested and run
 * during render (no effect, no layout read).
 */

import {
  BASEMAP_MAX_ZOOM,
  BASEMAP_URL_TEMPLATE,
  fillTileTemplate,
} from '@/lib/basemap';

export interface LatLng {
  lat: number;
  lng: number;
}

/** One basemap tile, positioned in the view's coordinate space. */
export interface PlateTile {
  /** Stable React key — the tile's own z/x/y, before dateline wrapping. */
  key: string;
  url: string;
  x: number;
  y: number;
  size: number;
}

export interface RoutePlate {
  /**
   * The integer zoom the *tiles* were requested at. The view itself is drawn at a
   * fractional scale between `zoom - 1` and `zoom` (see `planRoutePlate`), so this
   * is which tiles were fetched, not how far the view is zoomed in.
   */
  zoom: number;
  /**
   * How much of a native 256px tile one tile occupies on screen, 0.5–1. Always
   * ≤ 1: tiles are downscaled, never stretched.
   */
  tileScale: number;
  tiles: PlateTile[];
  /** The route, projected into view coordinates (same space as the tiles). */
  points: Array<{ x: number; y: number }>;
}

export const TILE_SIZE = 256;

/**
 * Deepest zoom we'll ever ask for — as deep as the basemap's raster cache goes
 * (see `BASEMAP_MAX_ZOOM`), because asking for more returns a grey placeholder
 * rather than a map. Only a route with no extent at all reaches it: `planRoutePlate`
 * scales the view so the route just fills the box, so a 5 km run lands far
 * shallower and the ceiling never enters into it.
 */
const MAX_ZOOM = BASEMAP_MAX_ZOOM;

/** The latitude where Mercator's y goes to infinity; clamp just inside it. */
const MAX_LATITUDE = 85.05112878;

/**
 * Web Mercator, normalised to the unit square: x runs 0→1 west→east, y runs
 * 0→1 north→south. Multiply by `TILE_SIZE * 2**zoom` for pixel coordinates.
 *
 * This replaces the old thumbnail's flat lat/lng projection with a cos(lat)
 * fudge — that was close enough for a bare line, but a line only sits on top of
 * real tiles if it uses the same projection they were cut with.
 */
export function toMercator({ lat, lng }: LatLng): { x: number; y: number } {
  const clamped = Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat));
  const rad = (clamped * Math.PI) / 180;
  return {
    x: (lng + 180) / 360,
    y: 0.5 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / (2 * Math.PI),
  };
}

function tileUrl(zoom: number, x: number, y: number): string {
  // The same light street plate the detail map uses, not the dark one: a dark
  // map plate inside a white card was the single dark rectangle on screen, and
  // sharing the plate means tapping a card doesn't change what the map looks
  // like. Provider and path order live in `lib/basemap.ts`.
  return fillTileTemplate(BASEMAP_URL_TEMPLATE, zoom, x, y);
}

/**
 * Fit `points` into a `width`×`height` box and return the tiles that cover it
 * plus the route in the same coordinates. `null` when there's no route to draw.
 *
 * `padding` is the margin the route keeps from the edge of the box, so a loop
 * that finishes where it started doesn't graze the border.
 *
 * ── Why the scale is fractional ─────────────────────────────────────────────
 * This used to pick the deepest **whole** zoom at which the route still fit, and
 * draw everything at that zoom's native resolution. Whole zoom levels are a factor
 * of two apart, so a route that just missed the next level down was drawn at half
 * the size it had room for. Measured over square loops from 0.6 to 5 km in a
 * 392×208 card, the route filled between 51% and 100% of the padded box — averaging
 * about 73%, and looking uniformly too far out.
 *
 * So the view is now scaled to fit exactly, and the *tiles* are fetched at the
 * whole zoom just above that scale and drawn slightly smaller (`tileScale`, always
 * between 0.5 and 1). Downscaling a sharp tile is invisible; upscaling is what
 * looks blurry, and rounding the other way would do that. This is what Leaflet
 * does with `zoomSnap: 0`, and it is the same reason the detail map now sets it.
 */
export function planRoutePlate(
  points: LatLng[],
  width: number,
  height: number,
  padding = 12,
): RoutePlate | null {
  const valid = (points || []).filter(
    (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng),
  );
  if (valid.length < 2) return null;

  const merc = valid.map(toMercator);
  const xs = merc.map((p) => p.x);
  const ys = merc.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const boxW = Math.max(width - padding * 2, 1);
  const boxH = Math.max(height - padding * 2, 1);

  // The exact size, in pixels, at which the whole Mercator square would have to be
  // drawn for the route's own extent to just fill the padded box. Whichever axis
  // is the tighter fit wins; the other keeps its slack, which is unavoidable when a
  // near-square route goes in a wide box.
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const ceiling = TILE_SIZE * 2 ** MAX_ZOOM;
  const world = Math.min(
    ceiling,
    // Both spans zero means every fix landed on the same spot — a treadmill run
    // with GPS on, or a watch that recorded one point twice. There is no extent to
    // fit, so it goes to the deepest zoom the basemap has and shows the street.
    Math.min(spanX > 0 ? boxW / spanX : Infinity, spanY > 0 ? boxH / spanY : Infinity),
  );

  // Tiles come from the whole zoom at or above this scale, so they are downscaled
  // into place rather than stretched. `tileScale` is therefore always in (0.5, 1].
  const zoom = Math.min(MAX_ZOOM, Math.max(0, Math.ceil(Math.log2(world / TILE_SIZE))));
  const tileScale = world / (TILE_SIZE * 2 ** zoom);
  const tilePx = TILE_SIZE * tileScale;

  const originX = ((minX + maxX) / 2) * world - width / 2;
  const originY = ((minY + maxY) / 2) * world - height / 2;

  const tiles: PlateTile[] = [];
  const count = 2 ** zoom;
  const firstX = Math.floor(originX / tilePx);
  const lastX = Math.floor((originX + width) / tilePx);
  const firstY = Math.floor(originY / tilePx);
  const lastY = Math.floor((originY + height) / tilePx);

  for (let ty = firstY; ty <= lastY; ty++) {
    // Latitude doesn't wrap — off the top or bottom of the world is just blank.
    if (ty < 0 || ty >= count) continue;
    for (let tx = firstX; tx <= lastX; tx++) {
      const wrapped = ((tx % count) + count) % count; // longitude does wrap
      tiles.push({
        key: `${zoom}/${tx}/${ty}`,
        url: tileUrl(zoom, wrapped, ty),
        x: tx * tilePx - originX,
        y: ty * tilePx - originY,
        // A hair over the lattice step. At a fractional scale the neighbouring
        // tile's left edge lands on a subpixel boundary, and without the overlap
        // the browser leaves a visible hairline of the grey backdrop between
        // every pair of tiles. 0.5px of stretch on a 256px image is invisible.
        size: tilePx + 0.5,
      });
    }
  }

  return {
    zoom,
    tileScale,
    tiles,
    points: merc.map((p) => ({ x: p.x * world - originX, y: p.y * world - originY })),
  };
}

/** An SVG path through already-projected points. */
export function toSvgPath(points: Array<{ x: number; y: number }>): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
}
