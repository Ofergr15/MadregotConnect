'use client';

export type RoutePoint = { lat: number; lng: number };

export function RouteMinimap({
  points,
  className = '',
}: {
  points: RoutePoint[];
  className?: string;
}) {
  const validPoints = points.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
  );
  if (validPoints.length < 2) return null;

  const lats = validPoints.map((point) => point.lat);
  const lngs = validPoints.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const width = 300;
  const height = 100;
  const padding = 12;

  // Longitude degrees get physically narrower away from the equator. Project
  // both axes into the same scale and center the route instead of stretching
  // latitude and longitude independently to fill the box.
  const middleLatitude = (minLat + maxLat) / 2;
  const longitudeScale = Math.max(Math.cos((middleLatitude * Math.PI) / 180), 0.01);
  const rawPoints = validPoints.map((point) => ({
    x: (point.lng - minLng) * longitudeScale,
    y: maxLat - point.lat,
  }));
  const xRange = Math.max(...rawPoints.map((point) => point.x), 0.000001);
  const yRange = Math.max(...rawPoints.map((point) => point.y), 0.000001);
  const scale = Math.min(
    (width - padding * 2) / xRange,
    (height - padding * 2) / yRange,
  );
  const offsetX = (width - xRange * scale) / 2;
  const offsetY = (height - yRange * scale) / 2;
  const projected = rawPoints.map((point) => ({
    x: offsetX + point.x * scale,
    y: offsetY + point.y * scale,
  }));
  const path = projected
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`aspect-[3/1] h-auto w-full rounded-xl ${className}`}
      role="img"
      aria-label="Route preview"
    >
      {/* Light system: the map plate is the page grey, so the thumbnail reads as
          part of the white card it sits on rather than the one dark rectangle on
          the screen. Route = band 3 (which is within a hair of the Strava orange
          it used to be), start/end = the accent green and red, ringed in white
          instead of navy so they still separate from the plate. */}
      <rect width={width} height={height} rx="12" fill="#DFDFDF" />
      <path
        d={path}
        fill="none"
        stroke="#FF5315"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={projected[0].x.toFixed(1)}
        cy={projected[0].y.toFixed(1)}
        r="4"
        fill="#16a34a"
        stroke="#FFFFFF"
        strokeWidth="1.5"
      />
      <circle
        cx={projected[projected.length - 1].x.toFixed(1)}
        cy={projected[projected.length - 1].y.toFixed(1)}
        r="4"
        fill="#D74E4E"
        stroke="#FFFFFF"
        strokeWidth="1.5"
      />
    </svg>
  );
}
