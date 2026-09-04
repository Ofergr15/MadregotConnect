'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BASEMAP_ATTRIBUTION,
  BASEMAP_MAX_ZOOM,
  BASEMAP_URL_TEMPLATE,
} from '@/lib/basemap';
import { cn } from '@/lib/utils';
import { getPaceColor } from './format';
import type { Split } from './types';

/**
 * The full-size route map: Leaflet, loaded from the CDN on first use.
 *
 * This is the heavyweight counterpart to `RouteMinimap` — pan, zoom, and a
 * pace-coloured polyline over the whole trace. Worth a map library on a detail
 * screen showing one run; not worth it on a feed card showing twenty.
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
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const [colorByPace, setColorByPace] = useState(false);

  useEffect(() => {
    if (!mapRef.current || points.length < 2) return;

    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    const initMap = () => {
      const L = (window as any).L;
      if (!L || !mapRef.current) return;

      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }

      const map = L.map(mapRef.current, {
        zoomControl: true,
        dragging: true,
        // Don't hijack page scroll when the cursor is over the map.
        scrollWheelZoom: false,
      });

      // Light plate, matching the design system and the feed thumbnails — this
      // was a dark one, which left the one dark rectangle on an otherwise light
      // screen. Attribution stays on: it's a condition of using these tiles.
      L.tileLayer(BASEMAP_URL_TEMPLATE, {
        maxZoom: BASEMAP_MAX_ZOOM,
        attribution: BASEMAP_ATTRIBUTION,
      }).addTo(map);

      const latlngs = points.map((p) => [p.lat, p.lng]);

      if (colorByPace && splits && splits.length > 1) {
        const paces = splits.map((s) => s.averagePace);
        const minP = Math.min(...paces);
        const maxP = Math.max(...paces);
        const ptsPerSplit = Math.floor(points.length / splits.length);

        for (let i = 0; i < splits.length; i++) {
          const start = i * ptsPerSplit;
          const end = i === splits.length - 1 ? points.length : (i + 1) * ptsPerSplit + 1;
          const segment = latlngs.slice(start, end);
          if (segment.length < 2) continue;
          L.polyline(segment, {
            color: getPaceColor(splits[i].averagePace, minP, maxP),
            weight: 5,
            opacity: 0.9,
          }).addTo(map);
        }
      } else {
        L.polyline(latlngs, { color: '#1525FF', weight: 4, opacity: 0.9 }).addTo(map);
        L.polyline(latlngs, { color: '#1525FF', weight: 8, opacity: 0.2 }).addTo(map);
      }

      L.circleMarker(latlngs[0], { radius: 7, fillColor: '#22c55e', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(map);
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, fillColor: '#ef4444', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(map);
      map.fitBounds(L.latLngBounds(latlngs), { padding: [20, 20] });
      mapInstance.current = map;
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
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [points, colorByPace, splits]);

  if (points.length < 2) return null;

  return (
    <div className="relative" style={{ zIndex: 0 }}>
      <div
        ref={mapRef}
        style={{ height: `${height}px`, position: 'relative', zIndex: 0 }}
        className="w-full rounded-xl"
      />
      {splits && splits.length > 1 && (
        <button
          onClick={() => setColorByPace(!colorByPace)}
          className={cn(
            'absolute top-3 end-3 z-[1000] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-lg',
            colorByPace
              ? 'bg-white text-ink-900'
              : 'bg-card/90 text-ink-500 hover:text-ink-900 border border-ink-300',
          )}
        >
          {colorByPace ? '● Pace Colors' : '○ Color by Pace'}
        </button>
      )}
      {colorByPace && (
        <div className="absolute bottom-3 start-3 z-[1000] bg-card/90 rounded-lg px-3 py-2 flex items-center gap-2 text-3xs font-medium shadow-lg">
          <span className="text-ink-400">Fast</span>
          <div className="flex gap-0.5">
            <div className="w-4 h-2 rounded-sm bg-[#22c55e]" />
            <div className="w-4 h-2 rounded-sm bg-[#eab308]" />
            <div className="w-4 h-2 rounded-sm bg-[#f97316]" />
            <div className="w-4 h-2 rounded-sm bg-[#ef4444]" />
          </div>
          <span className="text-ink-400">Slow</span>
        </div>
      )}
    </div>
  );
}
