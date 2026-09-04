import { describe, expect, it } from 'vitest';
import { decodePolyline, routeFromSummaryPolyline, type LatLng } from '@/lib/strava/polyline';

/**
 * The encoder, for tests only — the app never encodes. Having it here lets a
 * test state the coordinates it means and check they survive the round trip,
 * instead of asserting against a pasted string nobody can read.
 */
function encodePolyline(points: LatLng[]): string {
  const chunk = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let out = '';
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return out + String.fromCharCode(v + 63);
  };

  let lat = 0;
  let lng = 0;
  let out = '';
  for (const p of points) {
    const la = Math.round(p.lat * 1e5);
    const ln = Math.round(p.lng * 1e5);
    out += chunk(la - lat) + chunk(ln - lng);
    lat = la;
    lng = ln;
  }
  return out;
}

describe('decodePolyline', () => {
  it('decodes the reference example from the format specification', () => {
    // The canonical `_p~iF~ps|U_ulLnnqC_mqNvxq`@` → three points.
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(points).toHaveLength(3);
    expect(points[0].lat).toBeCloseTo(38.5, 5);
    expect(points[0].lng).toBeCloseTo(-120.2, 5);
    expect(points[1].lat).toBeCloseTo(40.7, 5);
    expect(points[1].lng).toBeCloseTo(-120.95, 5);
    expect(points[2].lat).toBeCloseTo(43.252, 5);
    expect(points[2].lng).toBeCloseTo(-126.453, 5);
  });

  it('round-trips a real-shaped route: small offsets from the previous point', () => {
    // A run's polyline is one absolute point followed by hundreds of tiny
    // offsets, which is a different code path from the reference vector's large
    // jumps. Encoding known coordinates here rather than pasting a literal:
    // an invented literal is not a polyline, it is just a string that decodes
    // to something.
    const route = [
      { lat: 32.0853, lng: 34.7818 }, // Tel Aviv seafront
      { lat: 32.0861, lng: 34.7809 },
      { lat: 32.087, lng: 34.7801 },
      { lat: 32.0884, lng: 34.7795 },
      { lat: 32.0899, lng: 34.7788 },
    ];

    const decoded = decodePolyline(encodePolyline(route));
    expect(decoded).toHaveLength(route.length);
    decoded.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(route[i].lat, 5);
      expect(p.lng).toBeCloseTo(route[i].lng, 5);
    });
  });

  it('returns nothing for empty, null and undefined input', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline(null)).toEqual([]);
    expect(decodePolyline(undefined)).toEqual([]);
  });

  it('returns nothing when a varint runs off the end of the string', () => {
    // Trailing group has the continuation bit set but no group follows.
    expect(decodePolyline('_p~iF~ps|U_')).toEqual([]);
  });

  it('returns nothing rather than a partial route when the stream misaligns', () => {
    // A character below the printable window (space is 32, the format starts
    // at 63) means this is not an encoded polyline at all.
    expect(decodePolyline('_p~iF~ps|U  ')).toEqual([]);
  });

  it('rejects a decode that drifts outside valid coordinates', () => {
    // Large repeated offsets walk latitude past the pole.
    expect(decodePolyline('_p~iF~ps|U' + '__~iF__ps|U'.repeat(4))).toEqual([]);
  });
});

describe('routeFromSummaryPolyline', () => {
  it('returns the points for a real route', () => {
    const route = routeFromSummaryPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(route).not.toBeNull();
    expect(route).toHaveLength(3);
  });

  it('treats a single point as no route', () => {
    // One stray GPS fix on a treadmill run. Giving the card a map area for this
    // is worse than giving it none.
    const single = decodePolyline('_p~iF~ps|U');
    expect(single).toHaveLength(1);
    expect(routeFromSummaryPolyline('_p~iF~ps|U')).toBeNull();
  });

  it('returns null for an absent polyline', () => {
    expect(routeFromSummaryPolyline(null)).toBeNull();
    expect(routeFromSummaryPolyline(undefined)).toBeNull();
    expect(routeFromSummaryPolyline('')).toBeNull();
  });
});
