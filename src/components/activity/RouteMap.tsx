'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BASEMAP_ATTRIBUTION,
  BASEMAP_MAX_ZOOM,
  BASEMAP_QUIET_FILTER,
  BASEMAP_URL_TEMPLATE,
} from '@/lib/basemap';
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

    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    const initMap = () => {
      const L = (window as any).L;
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

      // A real street map, not the near-blank grey plate this used to draw: the
      // point of zooming in is to see which streets and paths the run went
      // through. Attribution stays on — it's a condition of using these tiles.
      L.tileLayer(BASEMAP_URL_TEMPLATE, {
        maxZoom: BASEMAP_MAX_ZOOM,
        attribution: BASEMAP_ATTRIBUTION,
      }).addTo(map);

      // Quieted on the tile pane, not on the map container: Leaflet keeps tiles
      // and vectors in sibling panes, so this desaturates the streets and leaves
      // the route, the markers and the pace legend at full strength. Filtering
      // the container would drain the colour out of the very thing the colour
      // means something on.
      const tilePane = map.getPane('tilePane');
      if (tilePane) tilePane.style.filter = BASEMAP_QUIET_FILTER;

      // Leaflet refuses layer work before the map has a view; the route effect
      // below replaces this immediately.
      map.setView([31.5, 34.8], 7);
      // The detail page mounts this inside a container that is still settling.
      setTimeout(() => map.invalidateSize(), 100);

      mapInstance.current = map;
      setReady(true);
    };

    if ((window as any).L) {
      initMap();
    } else {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = initMap;
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
      setReady(false);
    };
  }, []);

  // ── Frame the route — only when the route itself changes ────────────────────
  // Deliberately not in the effect below: re-framing on a colour change would
  // undo the reader's own zoom every time they tapped the toggle.
  useEffect(() => {
    const map = mapInstance.current;
    const L = (window as any).L;
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
    const L = (window as any).L;
    if (!ready || !map || !L || stablePoints.length < 2) return;

    const layer = L.layerGroup().addTo(map);
    const latlngs = stablePoints.map((p) => [p.lat, p.lng]);
    const segments = showPaceColors ? paceSegments(latlngs.length, stablePaces) : null;

    if (segments) {
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
            'absolute top-3 right-3 z-[1000] min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-all shadow-lg',
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
