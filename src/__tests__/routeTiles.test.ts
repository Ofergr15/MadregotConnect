import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { TILE_SIZE, planRoutePlate, toMercator, toSvgPath } from '@/lib/activity/tiles';
import {
  BASEMAP_ATTRIBUTION,
  BASEMAP_MAX_ZOOM,
  BASEMAP_QUIET_MAX_ZOOM,
  BASEMAP_URL_TEMPLATE,
  BASEMAP_URL_TEMPLATE_DEEP,
  fillTileTemplate,
} from '@/lib/basemap';

/**
 * The feed's route thumbnails draw a real basemap by doing the tile arithmetic
 * themselves (a Leaflet instance per card is not an option on a page of 20
 * runs). If this projection disagrees with the one CARTO cut the tiles with, the
 * line silently sits on the wrong streets — which looks fine and is wrong, so
 * the arithmetic is pinned here rather than eyeballed.
 */
describe('toMercator', () => {
  it('puts null island at the centre of the unit square', () => {
    expect(toMercator({ lat: 0, lng: 0 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it('runs x west→east and y north→south', () => {
    expect(toMercator({ lat: 0, lng: -180 }).x).toBeCloseTo(0, 10);
    expect(toMercator({ lat: 0, lng: 180 }).x).toBeCloseTo(1, 10);
    expect(toMercator({ lat: 60, lng: 0 }).y).toBeLessThan(0.5);
    expect(toMercator({ lat: -60, lng: 0 }).y).toBeGreaterThan(0.5);
  });

  // The independent check that matters: y is computed as
  // `0.5 - ln(tan φ + sec φ)/2π`, and the same quantity has a second, unrelated
  // closed form, `(1 - asinh(tan φ)/π)/2`. Agreeing with that is evidence the
  // projection is really Mercator and not a lookalike — which is the failure
  // mode here, since a wrong-but-plausible projection still draws a nice line,
  // just over the wrong streets.
  it('agrees with the asinh form of Mercator y', () => {
    for (const lat of [0, 12.5, 32.0744, -45, 60, 84]) {
      const rad = (lat * Math.PI) / 180;
      expect(toMercator({ lat, lng: 0 }).y).toBeCloseTo((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2, 12);
    }
  });

  it('lands Tel Aviv on z12 tile 2443/1662', () => {
    const { x, y } = toMercator({ lat: 32.0744, lng: 34.7922 });
    expect(Math.floor(x * 2 ** 12)).toBe(2443);
    expect(Math.floor(y * 2 ** 12)).toBe(1662);
  });

  it('clamps the poles instead of returning Infinity', () => {
    expect(Number.isFinite(toMercator({ lat: 90, lng: 0 }).y)).toBe(true);
    expect(Number.isFinite(toMercator({ lat: -90, lng: 0 }).y)).toBe(true);
  });
});

describe('planRoutePlate', () => {
  // ~1km of a straight run along a Tel Aviv street.
  const route = Array.from({ length: 20 }, (_, i) => ({
    lat: 32.0744 + i * 0.0005,
    lng: 34.7922 + i * 0.0003,
  }));

  it('needs two points to draw anything', () => {
    expect(planRoutePlate([], 300, 100)).toBeNull();
    expect(planRoutePlate([{ lat: 32, lng: 34 }], 300, 100)).toBeNull();
  });

  it('ignores rows with a non-finite coordinate rather than producing NaN geometry', () => {
    const dirty = [
      { lat: 32.0744, lng: 34.7922 },
      { lat: Number.NaN, lng: 34.79 },
      { lat: 32.08, lng: Number.POSITIVE_INFINITY },
      { lat: 32.0844, lng: 34.7952 },
    ];
    const plate = planRoutePlate(dirty, 300, 100);
    expect(plate).not.toBeNull();
    expect(plate!.points).toHaveLength(2);
    expect(plate!.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('drops to null when only one point survives the filter', () => {
    expect(planRoutePlate([{ lat: 32, lng: 34 }, { lat: Number.NaN, lng: 0 }], 300, 100)).toBeNull();
  });

  it('fits the route inside the padded box', () => {
    const width = 300;
    const height = 100;
    const padding = 12;
    const plate = planRoutePlate(route, width, height, padding)!;
    const xs = plate.points.map((p) => p.x);
    const ys = plate.points.map((p) => p.y);
    // Centred, so the route's own extent has to sit within the padded window.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(padding - 0.001);
    expect(Math.max(...xs)).toBeLessThanOrEqual(width - padding + 0.001);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(padding - 0.001);
    expect(Math.max(...ys)).toBeLessThanOrEqual(height - padding + 0.001);
  });

  /**
   * The framing regression this whole group exists for.
   *
   * This used to pick the deepest WHOLE zoom that fit. Whole zooms are a factor of
   * two apart, so a route that just missed the next one was drawn at as little as
   * 51% of the space it had — measured across square loops from 0.6 to 5 km, the
   * fill ranged 51–100% and averaged ~73%. It read as "the map is zoomed out too
   * far", and no amount of adjusting the padding could fix it, because the cause was
   * the rounding and not the margin.
   */
  describe('framing', () => {
    /** Square loops with a side of `km`, near Tel Aviv. */
    const squareLoop = (km: number) => {
      const dLat = km / 111;
      const dLng = km / (111 * Math.cos((32.07 * Math.PI) / 180));
      return [
        { lat: 32.07, lng: 34.79 },
        { lat: 32.07 + dLat, lng: 34.79 },
        { lat: 32.07 + dLat, lng: 34.79 + dLng },
        { lat: 32.07, lng: 34.79 + dLng },
        { lat: 32.07, lng: 34.79 },
      ];
    };

    it('fills the tighter axis of the padded box, whatever size the route is', () => {
      const [W, H, pad] = [392, 208, 12];
      for (const km of [0.6, 0.9, 1.2, 1.8, 2.5, 3.5, 5, 8]) {
        const plate = planRoutePlate(squareLoop(km), W, H, pad)!;
        const ys = plate.points.map((p) => p.y);
        const spread = Math.max(...ys) - Math.min(...ys);
        // A square loop in a wide box is height-bound, so it fills the padded
        // height essentially exactly. Under the old whole-zoom rounding half of
        // these sat near 0.51 of it.
        expect(spread / (H - pad * 2)).toBeGreaterThan(0.999);
      }
    });

    it('never spills outside the padded box on either axis', () => {
      const [W, H, pad] = [392, 208, 12];
      for (const km of [0.4, 1, 2.7, 6]) {
        for (const pts of [squareLoop(km), route]) {
          const plate = planRoutePlate(pts, W, H, pad)!;
          const xs = plate.points.map((p) => p.x);
          const ys = plate.points.map((p) => p.y);
          expect(Math.min(...xs)).toBeGreaterThanOrEqual(pad - 0.001);
          expect(Math.max(...xs)).toBeLessThanOrEqual(W - pad + 0.001);
          expect(Math.min(...ys)).toBeGreaterThanOrEqual(pad - 0.001);
          expect(Math.max(...ys)).toBeLessThanOrEqual(H - pad + 0.001);
        }
      }
    });

    it('downscales tiles and never stretches them, so the plate stays sharp', () => {
      for (const km of [0.6, 0.9, 1.2, 1.8, 2.5, 3.5, 5]) {
        const plate = planRoutePlate(squareLoop(km), 392, 208, 12)!;
        // Rounding the tile zoom the other way would upscale, which is the one
        // thing that actually looks bad.
        expect(plate.tileScale).toBeGreaterThan(0.5);
        expect(plate.tileScale).toBeLessThanOrEqual(1);
      }
    });

    it('keeps a route with no extent at all inside the basemap ceiling', () => {
      // Same fix twice over: a treadmill run with GPS on records one spot, so
      // there is no span to divide by.
      const still = [{ lat: 32.07, lng: 34.79 }, { lat: 32.07, lng: 34.79 }];
      const plate = planRoutePlate(still, 392, 208)!;
      // The QUIET ceiling, not the map's: the thumbnail draws the canvas plate
      // alone, so its ceiling is that plate's cache, not the deepest zoom the
      // detail map can reach with a second layer.
      expect(plate.zoom).toBe(BASEMAP_QUIET_MAX_ZOOM);
      expect(plate.tileScale).toBe(1);
      expect(plate.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    });
  });

  it('covers the whole box with tiles and no gaps', () => {
    const width = 300;
    const height = 100;
    const plate = planRoutePlate(route, width, height)!;
    expect(plate.tiles.length).toBeGreaterThan(0);
    // Tiles are on a lattice at the view's scale and the union spans the box. Each
    // one carries a half-pixel of overlap — at a fractional scale, exact widths
    // leave a hairline of the grey backdrop showing between them.
    const step = TILE_SIZE * plate.tileScale;
    expect(plate.tiles.every((t) => t.size > step && t.size <= step + 0.5)).toBe(true);
    expect(Math.min(...plate.tiles.map((t) => t.x))).toBeLessThanOrEqual(0);
    expect(Math.min(...plate.tiles.map((t) => t.y))).toBeLessThanOrEqual(0);
    expect(Math.max(...plate.tiles.map((t) => t.x + t.size))).toBeGreaterThanOrEqual(width);
    expect(Math.max(...plate.tiles.map((t) => t.y + t.size))).toBeGreaterThanOrEqual(height);
  });

  it('gives every tile a distinct key and a z/y/x URL at the chosen zoom', () => {
    const plate = planRoutePlate(route, 300, 100)!;
    expect(new Set(plate.tiles.map((t) => t.key)).size).toBe(plate.tiles.length);
    for (const tile of plate.tiles) {
      expect(tile.url).toMatch(
        new RegExp(`/Canvas/World_Light_Gray_Base/MapServer/tile/${plate.zoom}/\\d+/\\d+$`),
      );
    }
  });

  // ⚠️ This provider paths its tiles `{z}/{y}/{x}` — row before column, the
  // reverse of every other XYZ service. Swapping them still returns a perfectly
  // valid-looking map of somewhere else entirely, so the order is pinned.
  it('puts y before x in the path, which is this provider’s order', () => {
    const plate = planRoutePlate([{ lat: 32.0744, lng: 34.7922 }, { lat: 32.0754, lng: 34.7932 }], 300, 100)!;
    const world = TILE_SIZE * 2 ** plate.zoom;
    for (const tile of plate.tiles) {
      // The tile's own lattice position, recovered from where it was placed.
      const [, y, x] = tile.url.split('/').slice(-3);
      const centre = toMercator({ lat: 32.0749, lng: 34.7927 });
      // x indexes longitude (~34.79°E → east of the meridian, past halfway).
      expect(Number(x)).toBeGreaterThan(2 ** plate.zoom / 2);
      // y indexes latitude and, for the northern hemisphere, is above halfway.
      expect(Number(y)).toBeLessThan(2 ** plate.zoom / 2);
      // And both are within a tile of the route's own position.
      expect(Math.abs(Number(x) - Math.floor((centre.x * world) / TILE_SIZE))).toBeLessThanOrEqual(1);
      expect(Math.abs(Number(y) - Math.floor((centre.y * world) / TILE_SIZE))).toBeLessThanOrEqual(1);
    }
  });

  // Deeper than the basemap's cache and you get a grey "Map data not yet
  // available" tile, which is indistinguishable from a failed load.
  it('never asks for a zoom past what the basemap has tiles for', () => {
    const tiny = [{ lat: 32.0744, lng: 34.7922 }, { lat: 32.07441, lng: 34.79221 }];
    expect(planRoutePlate(tiny, 300, 100)!.zoom).toBeLessThanOrEqual(BASEMAP_MAX_ZOOM);
  });

  it('wraps tile x across the dateline but never asks for a row off the poles', () => {
    // A route straddling ±180°: the box reaches past the edge of the world in x.
    const plate = planRoutePlate(
      [{ lat: 0, lng: 179.999 }, { lat: 0, lng: -179.999 }],
      300,
      100,
    )!;
    const count = 2 ** plate.zoom;
    for (const tile of plate.tiles) {
      const [, y, x] = tile.url.split('/').slice(-3);
      for (const n of [Number(x), Number(y)]) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(count);
      }
    }
  });
});

/**
 * CARTO — which every map in this app used to point at — did not start returning
 * 404 when it began requiring an API key. It returns 200, with a real map that
 * has "API KEY REQUIRED · carto.com/basemaps/apikey" stamped diagonally across
 * every tile. Nothing in a build, a typecheck or a test would ever have caught
 * that, and the calendar map had been shipping it. So the URL itself is the
 * assertion: one module names the provider, and nothing else hardcodes one.
 */
describe('basemap provider', () => {
  const SRC = fileURLToPath(new URL('../', import.meta.url));

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  // lib/basemap.ts is exempt: naming the dead provider is the whole point of the
  // comment that explains why the working one was chosen.
  const isProviderModule = (f: string) =>
    f.endsWith('lib/basemap.ts') || f.endsWith('routeTiles.test.ts');

  it('is not a keyed provider masquerading as a working one', () => {
    const offenders = sourceFiles(SRC).filter(
      (f) => !isProviderModule(f) && /cartocdn\.com/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('is named in exactly one module, so a dead provider is a one-line fix', () => {
    const offenders = sourceFiles(SRC).filter(
      (f) =>
        !isProviderModule(f) &&
        /MapServer\/tile|tile\.openstreetmap\.org|api\.mapbox\.com|tiles\.stadiamaps\.com/.test(
          readFileSync(f, 'utf8'),
        ),
    );
    expect(offenders).toEqual([]);
  });

  it('carries the attribution its terms require', () => {
    expect(BASEMAP_ATTRIBUTION).toMatch(/Esri/);
    expect(BASEMAP_ATTRIBUTION).toMatch(/OpenStreetMap/);
  });

  it('orders the template y before x', () => {
    expect(fillTileTemplate(BASEMAP_URL_TEMPLATE, 12, 2443, 1662)).toMatch(/\/12\/1662\/2443$/);
  });

  // TWO plates now, handing over at the canvas's ceiling (15046ef2). What can rot
  // here is the handover: a gap leaves a zoom level with no tiles at all, and an
  // overlap draws the dense plate over the quiet one at a zoom that should be
  // quiet. Neither is visible in a diff.
  describe('the two plates', () => {
    it('opens on the pale canvas, not the navigation plate', () => {
      expect(BASEMAP_URL_TEMPLATE).toMatch(/Canvas\/World_Light_Gray_Base/);
      expect(BASEMAP_URL_TEMPLATE_DEEP).toMatch(/World_Street_Map/);
    });

    it('hands over with no gap and no overlap', () => {
      // The canvas cache stops here — verified against the live service: z17
      // answers 200 with the 2,521-byte "Map data not yet available" placeholder.
      expect(BASEMAP_QUIET_MAX_ZOOM).toBe(16);
      // …and the street plate must start on the very next level, or a pinch lands
      // on a zoom with no tiles at all.
      expect(BASEMAP_QUIET_MAX_ZOOM).toBeLessThan(BASEMAP_MAX_ZOOM);
    });

    it('wires those exact bounds into the Leaflet layers', () => {
      const src = readFileSync(join(SRC, 'components/activity/RouteMap.tsx'), 'utf8');
      expect(src).toMatch(/maxZoom:\s*BASEMAP_QUIET_MAX_ZOOM/);
      expect(src).toMatch(/minZoom:\s*BASEMAP_QUIET_MAX_ZOOM \+ 1/);
      expect(src).toMatch(/maxZoom:\s*BASEMAP_MAX_ZOOM/);
    });

    it('keeps the thumbnail on one plate, clamped to that plate', () => {
      // The SVG thumbnail mounts no second layer, so asking past the canvas's
      // ceiling would hand it the grey placeholder — indistinguishable from a
      // failed load, in the one surface with no spinner.
      const src = readFileSync(join(SRC, 'lib/activity/tiles.ts'), 'utf8');
      expect(src).toMatch(/MAX_ZOOM = BASEMAP_QUIET_MAX_ZOOM/);
      expect(src).not.toMatch(/BASEMAP_URL_TEMPLATE_DEEP/);
    });

    // The old design desaturated the navigation plate to make it bearable as the
    // default. Both plates are now used as drawn — and if a filter is ever wanted
    // back, the SVG surface needs the primitive form, because Safari ignores CSS
    // `filter` on an inner SVG element outright. That bug shipped once: measured,
    // one real Esri tile, mean saturation raw 0.171 / CSS-in-SVG 0.171 (no
    // effect) / SVG filter 0.026.
    it('draws both plates unfiltered', () => {
      const offenders = sourceFiles(SRC).filter(
        (f) => !isProviderModule(f) && /grayscale\(|filter:\s*['`"]?grayscale/.test(readFileSync(f, 'utf8')),
      );
      expect(offenders).toEqual([]);
      const minimap = readFileSync(join(SRC, 'components/RouteMinimap.tsx'), 'utf8');
      expect(minimap).not.toMatch(/style=\{\{\s*filter:/);
    });
  });
});

describe('toSvgPath', () => {
  it('moves to the first point and lines to the rest', () => {
    expect(toSvgPath([{ x: 1.24, y: 2 }, { x: 3, y: 4.56 }])).toBe('M 1.2 2.0 L 3.0 4.6');
  });

  it('is empty for no points', () => {
    expect(toSvgPath([])).toBe('');
  });
});
