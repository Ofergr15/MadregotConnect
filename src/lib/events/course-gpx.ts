import type { LatLng } from '@/lib/strava/polyline';

/**
 * A race course from a GPX file → the geometry a map draws (parse only: no fetch, no storage, no DB).
 *
 * Input is untrusted text (an organiser's file the coach uploads). Deliberately not an XML parser:
 * a regex over `<trkpt>` / `<rtept>` attributes cannot be talked into resolving entities, and a file
 * that declares a DOCTYPE is refused outright. Bounded on size and on points; long tracks are thinned
 * by stride so a map gets ≤ MAX_POINTS, while the distance is measured on the full track.
 */

export const MAX_GPX_BYTES = 5_000_000;
export const MAX_POINTS = 2_000;

export interface CourseGeometry {
  points: LatLng[];
  /** Measured on every point of the file, before thinning. */
  distanceM: number;
  start: LatLng;
  finish: LatLng;
  bounds: { south: number; west: number; north: number; east: number };
  /** Points in the file, before thinning. */
  sourcePoints: number;
  name: string | null;
}

export type CourseParseError = 'too_large' | 'not_gpx' | 'doctype' | 'too_few_points' | 'bad_coordinate';

const POINT_RE = /<(trkpt|rtept)\b([^>]*)>/g;
const attr = (attrs: string, name: string) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(attrs);
  return m ? m[1] : null;
};

function haversineM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function parseCourseGpx(text: string): { ok: true; course: CourseGeometry } | { ok: false; error: CourseParseError } {
  if (text.length > MAX_GPX_BYTES) return { ok: false, error: 'too_large' };
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return { ok: false, error: 'doctype' };
  if (!/<gpx\b/i.test(text)) return { ok: false, error: 'not_gpx' };

  // A track wins over a route when a file carries both (organisers often ship both).
  const kind = /<trkpt\b/.test(text) ? 'trkpt' : 'rtept';
  const all: LatLng[] = [];
  for (const m of text.matchAll(POINT_RE)) {
    if (m[1] !== kind) continue;
    const lat = Number(attr(m[2], 'lat'));
    const lng = Number(attr(m[2], 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { ok: false, error: 'bad_coordinate' };
    }
    all.push({ lat, lng });
  }
  if (all.length < 2) return { ok: false, error: 'too_few_points' };

  let distanceM = 0;
  const bounds = { south: 90, west: 180, north: -90, east: -180 };
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    if (i > 0) distanceM += haversineM(all[i - 1], p);
    bounds.south = Math.min(bounds.south, p.lat); bounds.north = Math.max(bounds.north, p.lat);
    bounds.west = Math.min(bounds.west, p.lng); bounds.east = Math.max(bounds.east, p.lng);
  }

  const stride = Math.ceil(all.length / MAX_POINTS);
  const points = stride <= 1 ? all : all.filter((_, i) => i % stride === 0);
  if (points[points.length - 1] !== all[all.length - 1]) points.push(all[all.length - 1]); // the finish is never thinned away

  const nameM = /<(?:trk|rte)\b[^>]*>\s*<name>([^<]{0,200})<\/name>/.exec(text) || /<metadata>[\s\S]*?<name>([^<]{0,200})<\/name>/.exec(text);
  return {
    ok: true,
    course: {
      points, distanceM: Math.round(distanceM), start: all[0], finish: all[all.length - 1],
      bounds, sourcePoints: all.length, name: nameM ? nameM[1].trim() || null : null,
    },
  };
}
