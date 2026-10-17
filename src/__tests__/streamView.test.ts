import { describe, expect, it } from 'vitest';
import { streamHrZones, streamKmSplits, streamView } from '@/lib/activities/stream-view';
import type { ActivityStream } from '@/lib/garmin/streams';

/** A synthetic 1 Hz trace: `segments` of [seconds, pace sec/km, hr]. */
function trace(segments: Array<[number, number, number]>, elev?: (i: number) => number): ActivityStream {
  const t: number[] = [];
  const d: number[] = [];
  const hr: number[] = [];
  const el: number[] = [];
  const cad: number[] = [];
  let dist = 0;
  let sec = 0;
  for (const [n, pace, h] of segments) {
    for (let k = 0; k < n; k++) {
      sec += 1;
      dist += 1000 / pace;
      t.push(sec);
      d.push(dist);
      hr.push(h);
      cad.push(180);
      el.push(elev ? elev(t.length - 1) : 10);
    }
  }
  return { t, d, hr, elev: el, cad };
}

describe('streamKmSplits', () => {
  it('cuts real kilometres, not the lap average copied five times', () => {
    // 2 km at 4:00 then 2 km at 5:00 — a lap-averaged split would say 4:30 for all four.
    const s = trace([[480, 240, 150], [600, 300, 140]]);
    const km = streamKmSplits(s);
    expect(km.map(k => k.pace)).toEqual([240, 240, 300, 300]);
    expect(km.map(k => k.hr)).toEqual([150, 150, 140, 140]);
    // 1 Hz samples cross each kilometre a metre or so late.
    expect(km.every(k => Math.abs(k.distance - 1000) <= 5)).toBe(true);
  });

  it('folds a trailing stretch under 200 m into the last kilometre', () => {
    const s = trace([[1236, 300, 140]]); // 4.12 km
    const km = streamKmSplits(s);
    expect(km).toHaveLength(4);
    expect(km[3].distance).toBeGreaterThanOrEqual(1115);
    expect(km[3].distance).toBeLessThanOrEqual(1121);
  });

  it('keeps a trailing partial of 200 m or more as its own split', () => {
    const s = trace([[1350, 300, 140]]); // 4.5 km
    const km = streamKmSplits(s);
    expect(km).toHaveLength(5);
    expect(km[4].km).toBe(5);
    expect(Math.abs(km[4].distance - 500)).toBeLessThanOrEqual(5);
  });

  it('counts climb with hysteresis, so baro wobble is not elevation', () => {
    const wobble = trace([[300, 300, 140]], i => 10 + (i % 2) * 0.4);
    expect(streamKmSplits(wobble)[0].elevationGain).toBe(0);
    const hill = trace([[300, 300, 140]], i => 10 + i * 0.1);
    expect(streamKmSplits(hill)[0].elevationGain).toBeGreaterThanOrEqual(28);
  });
});

describe('streamView', () => {
  it('samples onto an even distance grid with time-over-distance pace', () => {
    const s = trace([[1200, 300, 140]]); // 4 km
    const v = streamView(s, { points: 40 })!;
    expect(v.d).toHaveLength(40);
    expect(v.d[v.d.length - 1]).toBeCloseTo(4, 2);
    expect(v.pace.every(p => p != null && Math.abs(p - 300) <= 2)).toBe(true);
    expect(v.hr).toBeDefined();
  });

  it('drops heart rate when the viewer may not see it', () => {
    const v = streamView(trace([[600, 300, 140]]), { points: 20, includeHr: false })!;
    expect(v.hr).toBeUndefined();
    expect(v.cad).toBeDefined();
  });

  it('draws a stop as a gap, not as a 40-minute kilometre', () => {
    const s = trace([[300, 300, 140]]);
    // standing still for 120 s
    const lastD = s.d[s.d.length - 1];
    for (let k = 1; k <= 120; k++) { s.t.push(s.t[s.t.length - 1] + 1); s.d.push(lastD); s.hr!.push(120); s.elev!.push(10); s.cad!.push(0); }
    const tail = trace([[300, 300, 140]]);
    const t0 = s.t[s.t.length - 1];
    tail.t.forEach((tt, i) => { s.t.push(t0 + tt); s.d.push(lastD + tail.d[i]); s.hr!.push(140); s.elev!.push(10); s.cad!.push(180); });
    const v = streamView(s, { points: 60 })!;
    expect(v.pace.some(p => p != null && p > 600)).toBe(false);
  });

  it('returns null for a trace too short to draw', () => {
    expect(streamView({ t: [0], d: [0] })).toBeNull();
  });
});

describe('streamHrZones', () => {
  it('buckets seconds by the same floors as getHRZone', () => {
    const s = trace([[100, 300, 110], [100, 300, 125], [100, 300, 140], [100, 300, 160], [100, 300, 180]]);
    const z = streamHrZones(s, 190)!;
    // The first sample has no interval before it, so zone 1 holds 99 s.
    expect(z).toEqual([99, 100, 100, 100, 100]);
  });

  it('is null without heart rate', () => {
    expect(streamHrZones({ t: [0, 1], d: [0, 3] }, 190)).toBeNull();
  });
});
