'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { planRoutePlate, toSvgPath, type LatLng } from '@/lib/activity/tiles';

export type RoutePoint = LatLng;

/**
 * The route thumbnail on a feed card — now on an actual map.
 *
 * It draws the basemap itself (see `planRoutePlate`) instead of mounting a map
 * library: a page of 20 feed cards means 20 of these, and Leaflet per card would
 * undo a lot of what the perf pass bought. Tiles are plain `<image>` elements in
 * the same SVG as the line, so the whole thing scales with the card and needs no
 * layout measurement.
 *
 * Tiles are only requested once the thumbnail is near the viewport. The line
 * renders immediately, so a card that is scrolled past never asks the network
 * for anything.
 */
export function RouteMinimap({
  points,
  className = '',
  width = 300,
  height = 100,
}: {
  points: RoutePoint[];
  className?: string;
  width?: number;
  height?: number;
}) {
  const plate = planRoutePlate(points, width, height);
  const clipId = useId();
  const hostRef = useRef<SVGSVGElement>(null);
  const [tilesVisible, setTilesVisible] = useState(false);

  useEffect(() => {
    if (tilesVisible) return;
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === 'undefined') {
      setTilesVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setTilesVisible(true);
          observer.disconnect();
        }
      },
      // Start fetching just before the card scrolls in, so the map is already
      // there by the time it's on screen.
      { rootMargin: '250px' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [tilesVisible]);

  if (!plate) return null;

  const path = toSvgPath(plate.points);
  const start = plate.points[0];
  const end = plate.points[plate.points.length - 1];

  return (
    <svg
      ref={hostRef}
      viewBox={`0 0 ${width} ${height}`}
      style={{ aspectRatio: `${width} / ${height}` }}
      className={`h-auto w-full rounded-xl ${className}`}
      role="img"
      aria-label="Route preview"
    >
      <defs>
        <clipPath id={clipId}>
          <rect width={width} height={height} rx="12" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {/* Page grey shows through until the tiles land, and stays as the
            backdrop for an indoor run with a stray fix or two. */}
        <rect width={width} height={height} fill="#DFDFDF" />
        {tilesVisible &&
          plate.tiles.map((tile) => (
            <image
              key={tile.key}
              href={tile.url}
              x={tile.x}
              y={tile.y}
              width={tile.size}
              height={tile.size}
              preserveAspectRatio="none"
            />
          ))}
        {/* Route = band 3 (within a hair of the Strava orange it used to be),
            start/end = the accent green and red, ringed in white so they stay
            legible over streets and parks alike. */}
        <path
          d={path}
          fill="none"
          stroke="#FF5315"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={start.x.toFixed(1)}
          cy={start.y.toFixed(1)}
          r="4"
          fill="#16a34a"
          stroke="#FFFFFF"
          strokeWidth="1.5"
        />
        <circle
          cx={end.x.toFixed(1)}
          cy={end.y.toFixed(1)}
          r="4"
          fill="#D74E4E"
          stroke="#FFFFFF"
          strokeWidth="1.5"
        />
        {/* Required wherever these tiles show. Kept short at this size — the
            full string is on the detail map, which has room for it. */}
        <text
          x={width - 4}
          y={height - 4}
          textAnchor="end"
          fontSize="6"
          fill="#1D1E26"
          opacity="0.55"
        >
          Esri · © OpenStreetMap
        </text>
      </g>
    </svg>
  );
}
