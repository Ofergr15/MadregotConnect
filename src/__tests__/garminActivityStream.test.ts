import { describe, expect, it } from 'vitest';
import {
  parseActivityStream,
  polylineFromDetails,
  paceAt,
  paceOverDistance,
  type ActivityStream,
} from '@/lib/garmin/streams';

/**
 * The per-sample trace out of Garmin's activity-details response.
 *
 * This is the evidence layer for "did they run the session", so what's pinned here
 * is what would corrupt a verdict rather than merely look wrong:
 *  - **Units.** `sumDistance` has been seen in both metres and kilometres. Reading
 *    kilometres as metres makes a 4:25 run look like a 4:25 *hour* and every pace
 *    derived from the trace is nonsense — silently, since the shape is still valid.
 *  - **Monotonicity.** A repeated sample after a pause, or GPS walking backwards,
 *    gives a segment of zero or negative length; a rep detector dividing by it gets
 *    Infinity and reports an impossible pace.
 *  - **Resolution.** A downsampled response can still grade a 20 km block while
 *    being useless for a 15-second stride, and the caller has to be able to tell.
 *  - **`paceOverDistance`.** The reason the trace is being stored at all: a plan of
 *    "2 km easy, 20 km at 4:25, 8 strides" is three answers, and the whole-run
 *    average is none of them.
 */

interface Sample {
  t: number;
  d: number;
  v?: number;
  hr?: number;
  lat?: number;
  lng?: number;
}

/** A details payload in Garmin's own shape: descriptors + one array per sample. */
function details(samples: Sample[], over: {
  distanceUnit?: string;
  withSpeed?: boolean;
  withHr?: boolean;
  withLatLng?: boolean;
  polyline?: Array<{ lat: number; lon: number }>;
} = {}) {
  const { distanceUnit = 'meter', withSpeed = true, withHr = true, withLatLng = false } = over;
  const keys = ['sumElapsedDuration', 'sumDistance'];
  const units: Record<string, string> = { sumElapsedDuration: 'second', sumDistance: distanceUnit };
  if (withSpeed) { keys.push('directSpeed'); units.directSpeed = 'mps'; }
  if (withHr) { keys.push('directHeartRate'); units.directHeartRate = 'bpm'; }
  if (withLatLng) {
    keys.push('directLatitude', 'directLongitude');
    units.directLatitude = 'dd'; units.directLongitude = 'dd';
  }
  return {
    metricDescriptors: keys.map((key, i) => ({ key, metricsIndex: i, unit: { key: units[key] } })),
    activityDetailMetrics: samples.map(s => ({
      metrics: keys.map(key => {
        switch (key) {
          case 'sumElapsedDuration': return s.t;
          case 'sumDistance': return distanceUnit === 'kilometer' ? s.d / 1000 : s.d;
          case 'directSpeed': return s.v ?? 3.7;
          case 'directHeartRate': return s.hr ?? 140;
          case 'directLatitude': return s.lat ?? 32.1;
          case 'directLongitude': return s.lng ?? 34.8;
          default: return null;
        }
      }),
    })),
    ...(over.polyline ? { geoPolylineDTO: { polyline: over.polyline } } : {}),
  };
}

/** A run at a steady pace, one sample a second. */
const steady = (seconds: number, paceSecPerKm: number, from = { t: 0, d: 0 }): Sample[] => {
  const mps = 1000 / paceSecPerKm;
  return Array.from({ length: seconds }, (_, i) => ({
    t: from.t + i + 1,
    d: Math.round(from.d + mps * (i + 1)),
    v: mps,
  }));
};

describe('parseActivityStream', () => {
  it('reads the trace into index-aligned columnar arrays', () => {
    const parsed = parseActivityStream(details(steady(10, 300)));
    expect(parsed).not.toBeNull();
    expect(parsed!.series.t).toHaveLength(10);
    expect(parsed!.series.d).toHaveLength(10);
    expect(parsed!.series.hr).toHaveLength(10);
    expect(parsed!.sampleCount).toBe(10);
    expect(parsed!.metrics).toEqual(['t', 'd', 'v', 'hr']);
    // Speed is stored as cm/s: 3.33 m/s at 5:00/km.
    expect(parsed!.series.v![0]).toBe(333);
  });

  // The unofficial API reports this field in either unit. Reading the descriptor is
  // the difference between a 24 km run and a 24 m one.
  it('converts a kilometre-unit distance axis to metres', () => {
    const parsed = parseActivityStream(details(steady(60, 300), { distanceUnit: 'kilometer' }));
    expect(parsed!.series.d[59]).toBe(200); // 60 s at 5:00/km
  });

  // Belt and braces for the case above: if the unit ever lies, the activity's own
  // distance catches it, because a 1000x error is a unit mistake and nothing else.
  it('rescales a distance axis that is off by a factor of 1000', () => {
    // Payload claims metres but the numbers are kilometres — 200 m reported as 0.2.
    const samples = steady(60, 300).map(s => ({ ...s, d: s.d / 1000 }));
    const parsed = parseActivityStream(details(samples), 200);
    expect(parsed!.unitCorrection).toBe('distance x1000');
    expect(parsed!.series.d[59]).toBe(200);
  });

  it('leaves a normal 2% summary-versus-trace discrepancy alone', () => {
    const parsed = parseActivityStream(details(steady(60, 300)), 204);
    expect(parsed!.unitCorrection).toBeUndefined();
    expect(parsed!.series.d[59]).toBe(200);
  });

  // A watch resuming after a pause re-reports a sample; a GPS glitch walks distance
  // backwards. Either one gives a zero- or negative-length segment.
  it('drops samples that do not move forward on both axes', () => {
    const parsed = parseActivityStream(details([
      { t: 1, d: 3 }, { t: 2, d: 7 },
      { t: 2, d: 7 },       // repeated timestamp
      { t: 3, d: 5 },       // distance walked backwards
      { t: 4, d: 14 },
    ]));
    expect(parsed!.series.t).toEqual([1, 2, 4]);
    expect(parsed!.series.d).toEqual([3, 7, 14]);
  });

  it('reports the sample interval, so a caller can tell a downsampled trace', () => {
    expect(parseActivityStream(details(steady(20, 300)))!.intervalSec).toBe(1);
    // Garmin capped maxChartSize: every third second. A 15-second rep is 5 samples
    // here, and its boundaries are ±3 s — the caller needs to know that.
    const sparse = steady(60, 300).filter((_, i) => i % 3 === 0);
    expect(parseActivityStream(details(sparse))!.intervalSec).toBe(3);
  });

  it('omits a metric the response did not carry, rather than filling it with nulls', () => {
    const parsed = parseActivityStream(details(steady(10, 300), { withHr: false, withSpeed: false }));
    expect(parsed!.series.hr).toBeUndefined();
    expect(parsed!.series.v).toBeUndefined();
    expect(parsed!.metrics).toEqual(['t', 'd']);
  });

  it('returns null when there is no usable trace', () => {
    expect(parseActivityStream(null)).toBeNull();
    expect(parseActivityStream({})).toBeNull();
    // An indoor activity with no distance axis: HR only.
    expect(parseActivityStream({
      metricDescriptors: [{ key: 'directHeartRate', metricsIndex: 0, unit: { key: 'bpm' } }],
      activityDetailMetrics: [{ metrics: [140] }, { metrics: [141] }],
    })).toBeNull();
    // One sample is not a series.
    expect(parseActivityStream(details([{ t: 1, d: 3 }]))).toBeNull();
  });
});

describe('polylineFromDetails', () => {
  it('prefers the polyline DTO', () => {
    const points = polylineFromDetails(details(steady(3, 300), {
      polyline: [{ lat: 32.2, lon: 34.8 }, { lat: 32.3, lon: 34.9 }],
    }));
    expect(points).toEqual([{ lat: 32.2, lng: 34.8 }, { lat: 32.3, lng: 34.9 }]);
  });

  it('falls back to the lat/lng metrics when there is no DTO', () => {
    const points = polylineFromDetails(details(
      [{ t: 1, d: 3, lat: 32.1, lng: 34.8 }, { t: 2, d: 7, lat: 32.2, lng: 34.9 }],
      { withLatLng: true },
    ));
    expect(points).toEqual([{ lat: 32.1, lng: 34.8 }, { lat: 32.2, lng: 34.9 }]);
  });

  it('returns [] for an activity with no GPS at all', () => {
    expect(polylineFromDetails(details(steady(3, 300)))).toEqual([]);
  });
});

describe('paceAt', () => {
  it('converts stored cm/s to s/km', () => {
    const series: ActivityStream = { t: [1], d: [4], v: [377] }; // 3.77 m/s
    expect(paceAt(series, 0)).toBe(265); // 4:25/km
  });

  // A walk-recovery sample at a standstill is not a 3-hour pace, it is no pace.
  it('is null while standing still', () => {
    expect(paceAt({ t: [1], d: [0], v: [0] }, 0)).toBeNull();
    expect(paceAt({ t: [1], d: [0] }, 0)).toBeNull();
  });
});

describe('paceOverDistance', () => {
  /**
   * The real published Sunday: 2 km at 5:00, 20 km at 4:23, then 8x15s strides with
   * walk recoveries. Whole-run average came out 4:33 and the athlete was told they
   * missed a 4:25 target — while the 20 km block they were actually asked to run at
   * 4:25 was run at 4:23.
   */
  const sunday = (() => {
    const warm = steady(600, 300);                                      // 2 km @ 5:00
    const main = steady(5260, 263, warm[warm.length - 1]);              // 20 km @ 4:23
    const strides: Sample[] = [];
    let cursor = main[main.length - 1];
    for (let rep = 0; rep < 8; rep++) {
      const hard = steady(15, 200, cursor);                             // 15 s @ 3:20
      strides.push(...hard);
      cursor = hard[hard.length - 1];
      const walk = steady(45, 900, cursor);                             // 45 s walking
      strides.push(...walk);
      cursor = walk[walk.length - 1];
    }
    return parseActivityStream(details([...warm, ...main, ...strides]))!;
  })();

  it('grades the block the plan set a pace for, not the whole run', () => {
    const whole = paceOverDistance(sunday.series, 0, sunday.series.d.at(-1)!);
    const block = paceOverDistance(sunday.series, 2000, 22000);
    // What the athlete was told, versus what they ran. The gap is the warm-up and
    // the walk breaks, and it is the whole reason this helper exists.
    expect(whole).toBeGreaterThan(270);
    expect(block).toBeGreaterThanOrEqual(262);
    expect(block).toBeLessThanOrEqual(264);
  });

  it('is computed from time and distance, not by averaging sample paces', () => {
    // 100 s at 4:00/km (417 m) then 100 s at 8:00/km (208 m). Time over distance
    // says 625 m in 200 s = 3:20/km; averaging the samples' own paces says
    // (240 + 480) / 2 = 6:00/km, because 1 Hz sampling weights by time and the
    // slow half covers half the samples but a third of the ground. The first is
    // the pace the athlete ran; the second flatters a session with walk breaks in
    // it, which is every interval session.
    const fast = steady(100, 240);
    const slow = steady(100, 480, fast[fast.length - 1]);
    const parsed = parseActivityStream(details([...fast, ...slow]))!;
    const pace = paceOverDistance(parsed.series, 0, parsed.series.d.at(-1)!)!;
    expect(pace).toBeGreaterThanOrEqual(319);
    expect(pace).toBeLessThanOrEqual(321);
  });

  it('refuses a window too short to mean anything', () => {
    expect(paceOverDistance(sunday.series, 0, 40)).toBeNull();
    expect(paceOverDistance(sunday.series, 5000, 5000)).toBeNull();
  });
});
