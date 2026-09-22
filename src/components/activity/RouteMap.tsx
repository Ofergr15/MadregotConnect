'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BASEMAP_ATTRIBUTION,
  BASEMAP_MAX_ZOOM,
  BASEMAP_QUIET_MAX_ZOOM,
  BASEMAP_URL_TEMPLATE,
  BASEMAP_URL_TEMPLATE_DEEP,
} from '@/lib/basemap';
import { loadLeaflet } from '@/lib/leaflet';
import { useMapPrefs } from '@/lib/mapPrefs';
import { cn } from '@/lib/utils';
import { PACE_COLOR_RAMP, paceSegments } from './format';
import type { Split } from './types';

/**
 * The full-size route map: Leaflet, loaded from the CDN on first use.
 *
 * This is the heavyweight counterpart to `RouteMinimap` — pan, zoom, and an
 * optional pace heat map over the whole trace. Worth a map library on a detail
 * screen showing one run; not worth it on a feed card showing twenty.
 *
 * ⚠️ The map is built **once** and then only its route layer is redrawn. It used
 * to be torn down and rebuilt — including a `fitBounds` — whenever `points`,
 * `splits` or the colour mode changed, and none of `ActivityDetailBody`'s three
 * values are referentially stable (`details?.splits || act.splits || []` is a
 * fresh array every render). So any re-render anywhere on the detail page threw
 * the map away and snapped the view back to the whole route: the reader would
 * zoom in, something re-rendered, and the zoom was gone. That is what "we can't
 * zoom in" was. `useStableValue` below is what keeps it fixed — the effects key
 * off the *contents* of those props, not their identity.
 */
export function RouteMap({
  points,
  height = 300,
  splits,
}: {
  points: Array<{ lat: number; lng: number }>;
  height?: number;
  splits?: Split[];
}) {
  const t = useTranslations('activities');
  const [{ paceColors }, setMapPrefs] = useMapPrefs();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  /**
   * The leaflet instance THIS map was built with.
   *
   * Every effect below used to re-read `window.L`. That is the same object right up
   * until a second copy of the library loads and overwrites it — and then a bounds
   * object from the new instance is an unrecognised shape to the old instance's
   * `fitBounds`, which throws "Bounds are not valid." and takes the whole screen
   * down through the error boundary. `lib/leaflet.ts` makes the double load
   * impossible; holding the instance here makes the mix impossible even if
   * something else on the page ever loads its own.
   */
  const leafletRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  // Route and per-km paces, pinned to their contents. `points` is up to a few
  // thousand entries, so the signature is length plus the endpoints rather than
  // the whole thing — enough to tell one run's trace from another's.
  const stablePoints = useStableValue(
    points,
    `${points.length}|${points[0]?.lat},${points[0]?.lng}|${points[points.length - 1]?.lat},${points[points.length - 1]?.lng}`,
  );
  const paces = (splits || []).map((s) => s.averagePace);
  const stablePaces = useStableValue(paces, paces.join(','));

  const canColorByPace = stablePaces.length > 1;
  const showPaceColors = paceColors && canColorByPace;

  // ── Create the map once ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    let cancelled = false;

    const initMap = (L: any) => {
      if (cancelled || !L || !mapRef.current || mapInstance.current) return;

      const map = L.map(mapRef.current, {
        zoomControl: true,
        dragging: true,
        // The reason this map could only zoom two or three steps: Leaflet takes
        // the map's ceiling from its tile layer, and the old grey basemap's
        // raster cache stopped at z16. The street plate runs to 19.
        maxZoom: BASEMAP_MAX_ZOOM,
        // Let `fitBounds` below land on a fractional zoom. Leaflet's default snaps
        // the view to whole zoom levels and rounds *down*, and whole levels are a
        // factor of two apart — so a route that just missed the next level was
        // framed at up to half the size it had room for, which is what "the route
        // is too zoomed out" was. The tiles are then drawn slightly scaled, the
        // same trade the feed thumbnail makes in `planRoutePlate`.
        zoomSnap: 0,
        // …but the +/− buttons and a double-tap still move a whole level, so
        // zooming by hand doesn't turn into a crawl now that the base is fractional.
        zoomDelta: 1,
        wheelPxPerZoomLevel: 120,
        // Pinch and double-tap are the zoom gestures that actually matter — this
        // is read on a phone. Stated explicitly rather than left to the defaults
        // so a later edit can't quietly drop them.
        touchZoom: true,
        doubleClickZoom: true,
        // The wheel starts off so that scrolling the page *past* the map doesn't
        // zoom it, and turns on once the map is deliberately clicked — the
        // compromise every embedded map settles on. Touch is unaffected either
        // way.
        scrollWheelZoom: false,
      });
      map.on('click', () => map.scrollWheelZoom.enable());
      map.on('mouseout', () => map.scrollWheelZoom.disable());

      // TWO plates, handing over at the canvas's own ceiling (15046ef2).
      //
      // The pale canvas is what a route should sit on: at the zooms this map
      // actually opens at — a fitted 5 km loop lands around z14–15 — the reader
      // should see their line, not a page of doubled street labels. Its raster
      // cache stops at z16, which is the entire reason the app used to draw the
      // navigation plate everywhere instead.
      //
      // So the street plate stays, as the DEEP layer. Leaflet shows a tile layer
      // only inside its own min/max zoom, so the swap is declarative: the canvas
      // covers up to z16, the street map takes over at z17 and carries the map's
      // ceiling to z19. `+` keeps working exactly as far as it did.
      //
      // Attribution goes on the canvas layer only — Leaflet concatenates the
      // attributions of every layer currently shown, and both plates credit the
      // same suppliers, so putting it on both prints it twice at z17+.
      L.tileLayer(BASEMAP_URL_TEMPLATE, {
        maxZoom: BASEMAP_QUIET_MAX_ZOOM,
        attribution: BASEMAP_ATTRIBUTION,
      }).addTo(map);
      L.tileLayer(BASEMAP_URL_TEMPLATE_DEEP, {
        minZoom: BASEMAP_QUIET_MAX_ZOOM + 1,
        maxZoom: BASEMAP_MAX_ZOOM,
      }).addTo(map);

      // Leaflet refuses layer work before the map has a view; the route effect
      // below replaces this immediately.
      map.setView([31.5, 34.8], 7);
      // The detail page mounts this inside a container that is still settling.
      setTimeout(() => map.invalidateSize(), 100);

      leafletRef.current = L;
      mapInstance.current = map;
      setReady(true);
    };

    // One shared load for the whole document — see `lib/leaflet.ts`. This used to
    // append its own `<script>` whenever `window.L` was not set yet, which under
    // React's development double-mount is twice on one page, and once more for
    // every visit to the calendar's own map.
    loadLeaflet().then(initMap).catch(() => { /* no map; the page is still fine */ });

    return () => {
      cancelled = true;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
      leafletRef.current = null;
      setReady(false);
    };
  }, []);

  // ── Frame the route — only when the route itself changes ────────────────────
  // Deliberately not in the effect below: re-framing on a colour change would
  // undo the reader's own zoom every time they tapped the toggle.
  useEffect(() => {
    const map = mapInstance.current;
    const L = leafletRef.current;
    if (!ready || !map || !L || stablePoints.length < 2) return;
    // 14px, down from 20. With `zoomSnap: 0` the padding is now the *only* thing
    // standing between the route and the edge of the map, so it stops being a
    // rounding cushion and becomes what it says: enough margin that the start and
    // end markers (7px radius plus their white ring) sit clear of the border.
    map.fitBounds(
      L.latLngBounds(stablePoints.map((p) => [p.lat, p.lng])),
      { padding: [14, 14] },
    );
  }, [ready, stablePoints]);

  // ── Draw the route, recoloured in place ────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    const L = leafletRef.current;
    if (!ready || !map || !L || stablePoints.length < 2) return;

    const layer = L.layerGroup().addTo(map);
    const latlngs = stablePoints.map((p) => [p.lat, p.lng]);
    const segments = showPaceColors ? paceSegments(latlngs.length, stablePaces) : null;

    if (segments) {
      // One continuous white casing UNDER the whole route, drawn once before the
      // coloured segments — not per segment, which would paint white over each
      // neighbour's end and leave a dotted seam. The pace ramp's light end is
      // #60a5fa, which is a legible mark on paper and a weak one over satellite
      // imagery; a casing is the mark-on-busy-ground fix, and it also stops two
      // adjacent segments of similar step from bleeding into one stroke.
      L.polyline(latlngs, { color: '#fff', weight: 9, opacity: 0.7 }).addTo(layer);
      for (const seg of segments) {
        L.polyline(latlngs.slice(seg.start, seg.end), {
          color: seg.color,
          weight: 5,
          opacity: 0.9,
        }).addTo(layer);
      }
    } else {
      // Halo first, line on top. The other way round — which is how this was —
      // lays a translucent 8px band over the 4px line and dulls it.
      L.polyline(latlngs, { color: '#1525FF', weight: 8, opacity: 0.2 }).addTo(layer);
      L.polyline(latlngs, { color: '#1525FF', weight: 4, opacity: 0.9 }).addTo(layer);
    }

    // Start green / finish red. These are two named PLACES, not two rungs of the
    // pace scale — and now that the ramp is a single blue hue they can't be read as
    // one. While the ramp started on #22c55e the start marker was literally the
    // fastest-kilometre colour, so a green stretch of line and "this is where you
    // set off" were the same paint.
    L.circleMarker(latlngs[0], { radius: 7, fillColor: '#22c55e', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(layer);
    L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, fillColor: '#ef4444', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(layer);

    return () => layer.remove();
  }, [ready, stablePoints, stablePaces, showPaceColors]);

  if (points.length < 2) return null;

  return (
    <div className="relative" style={{ zIndex: 0 }}>
      <div
        ref={mapRef}
        style={{ height: `${height}px`, position: 'relative', zIndex: 0 }}
        className="w-full rounded-xl"
      />
      {/* A shortcut to the same preference Settings owns, on the screen where
          you notice you want it. Only shown when there are splits to colour by —
          a run with no per-km data would toggle to no visible effect.

          ⚠️ `right-3`, not `end-3`. Leaflet positions its own controls with
          physical `left`/`right` and does not flip them for RTL, so on this
          Hebrew-default app `end-3` put this chip exactly on top of the zoom
          control — 85×36 of button over the 30×30 `+`/`−`, swallowing every tap.
          That is the other half of "we can't zoom in", and no amount of maxZoom
          fixes it. Same reason the legend below is `left-3`: physical bottom
          right is where Leaflet keeps the attribution, which has to stay
          readable. */}
      {canColorByPace && (
        <button
          onClick={() => setMapPrefs({ paceColors: !paceColors })}
          aria-pressed={showPaceColors}
          className={cn(
            // 36 tall measured, 44 needed. The visible chip keeps its height —
            // growing it would eat more of the map, and it is already the widest
            // thing floating over the trace — so the extra 4px a side is an
            // invisible `after:` halo. The chip is `absolute`, which is its own
            // positioning context, and nothing sits within 4px of it: the zoom
            // control is physical top-LEFT and the legend is bottom-left.
            'absolute top-3 right-3 z-[1000] min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-all shadow-lg',
            "after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-['']",
            showPaceColors
              ? 'bg-white text-ink-900'
              : 'bg-card/90 text-ink-500 hover:text-ink-900 border border-ink-300',
          )}
        >
          {showPaceColors ? '● ' : '○ '}
          {t('mapPaceColors')}
        </button>
      )}
      {/* `bottom-10`, not `bottom-3`: on a phone the attribution wraps to two
          lines and spans the full width, so a legend sitting at the very bottom
          covers the "Esri, HERE," half of it. Attribution has to stay readable —
          it's the condition on using these tiles. */}
      {showPaceColors && (
        <div className="absolute bottom-10 left-3 z-[1000] bg-card/90 rounded-lg px-3 py-2 flex items-center gap-2 text-3xs font-medium shadow-lg">
          <span className="text-ink-400">{t('paceFast')}</span>
          <div className="flex gap-0.5">
            {PACE_COLOR_RAMP.map((color) => (
              <div key={color} className="w-4 h-2 rounded-sm" style={{ backgroundColor: color }} />
            ))}
          </div>
          <span className="text-ink-400">{t('paceSlow')}</span>
        </div>
      )}
    </div>
  );
}

/**
 * `value`, but holding its previous identity for as long as `key` is unchanged.
 *
 * The standard "derive from props" render-time ref write. It exists so the
 * effects above can depend on what the props *contain* — a caller handing us a
 * freshly-built array of the same route on every render must not count as a new
 * route, because rebuilding the map costs the reader their zoom.
 */
function useStableValue<T>(value: T, key: string): T {
  const held = useRef(value);
  const heldKey = useRef(key);
  if (heldKey.current !== key) {
    heldKey.current = key;
    held.current = value;
  }
  return held.current;
}
