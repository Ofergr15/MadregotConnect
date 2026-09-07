import { describe, it, expect } from 'vitest';
import { getPaceColor, PACE_COLOR_RAMP, paceSegments } from '@/components/activity/format';

/**
 * The pace heat map's geometry. Both maps that draw it — the interactive detail
 * map (thousands of points) and the feed thumbnail (~60) — go through this, so
 * the same run must not be cut differently on the two screens.
 */
describe('paceSegments', () => {
  const paces = [300, 310, 320, 330];

  it('covers the whole line, in order, with no gap between bands', () => {
    const segments = paceSegments(41, paces)!;
    expect(segments).toHaveLength(4);
    expect(segments[0].start).toBe(0);
    expect(segments[segments.length - 1].end).toBe(41);
    for (let i = 1; i < segments.length; i++) {
      // Each band reaches one point into the next, so the joins are seamless
      // rather than a hairline of background colour.
      expect(segments[i].start).toBe(segments[i - 1].end - 1);
    }
  });

  it('shares the points out evenly instead of dumping the remainder on the last km', () => {
    // 61 points over 8 splits: flooring gives 7 each and leaves the last split
    // covering 12 — nearly double the line for one kilometre, which is what the
    // old inline version did.
    const segments = paceSegments(61, [300, 305, 310, 315, 320, 325, 330, 335])!;
    const spans = segments.map((s) => s.end - s.start);
    expect(Math.max(...spans) - Math.min(...spans)).toBeLessThanOrEqual(1);
  });

  it('colours the fastest split green and the slowest red, normalised within the run', () => {
    const segments = paceSegments(41, paces)!;
    expect(segments[0].color).toBe(PACE_COLOR_RAMP[0]);
    expect(segments[segments.length - 1].color).toBe(PACE_COLOR_RAMP[3]);
  });

  it('normalises per run: a fast interval session and a slow long run both use the full ramp', () => {
    const intervals = paceSegments(41, [200, 210, 220, 230])!;
    const longRun = paceSegments(41, [380, 390, 400, 410])!;
    expect(intervals.map((s) => s.color)).toEqual(longRun.map((s) => s.color));
  });

  it('is null when there is nothing meaningful to colour', () => {
    expect(paceSegments(41, [])).toBeNull();
    expect(paceSegments(41, [300])).toBeNull();
    // Fewer points than splits: no band could hold a two-point line.
    expect(paceSegments(3, paces)).toBeNull();
    expect(paceSegments(0, paces)).toBeNull();
  });

  it('refuses a set with a junk pace rather than colouring it as the fastest km', () => {
    expect(paceSegments(41, [300, Number.NaN, 320])).toBeNull();
    expect(paceSegments(41, [300, 0, 320])).toBeNull();
    expect(paceSegments(41, [300, -5, 320])).toBeNull();
  });

  it('indexes are usable as a slice directly', () => {
    const points = Array.from({ length: 41 }, (_, i) => i);
    const segments = paceSegments(points.length, paces)!;
    for (const seg of segments) {
      const slice = points.slice(seg.start, seg.end);
      expect(slice.length).toBeGreaterThanOrEqual(2);
      expect(slice[0]).toBe(seg.start);
    }
  });
});

describe('getPaceColor', () => {
  it('does not divide by zero when every split was the same pace', () => {
    expect(getPaceColor(300, 300, 300)).toBe(PACE_COLOR_RAMP[0]);
  });

  it('spreads the four steps evenly and puts the slowest split on the last one', () => {
    // ratio 0 / .25 / .5 / .75 / 1 over a 0–400 range.
    expect(getPaceColor(0, 0, 400)).toBe(PACE_COLOR_RAMP[0]);
    expect(getPaceColor(100, 0, 400)).toBe(PACE_COLOR_RAMP[1]);
    expect(getPaceColor(200, 0, 400)).toBe(PACE_COLOR_RAMP[2]);
    expect(getPaceColor(300, 0, 400)).toBe(PACE_COLOR_RAMP[3]);
    // ratio exactly 1 indexes one past the end unless it's clamped.
    expect(getPaceColor(400, 0, 400)).toBe(PACE_COLOR_RAMP[3]);
  });

  // The ramp is ONE HUE, light→dark, on purpose. Not green→yellow→orange→red
  // (red/green is the pair ~8% of men can't separate, and in this app red is the
  // "something is wrong" colour — a slow recovery kilometre is not wrong), and no
  // longer green→teal→sky→blue either: that one put all its information in hue at
  // a single lightness, so its first two steps measured ΔE 11.3 for normal vision
  // and 2.0 for tritan readers. Locked so a future "let's make it more colourful"
  // has to come through this test and read the reasoning in format.ts.
  it('is a single-hue light→dark ramp, not a rainbow', () => {
    expect(PACE_COLOR_RAMP).toEqual(['#60a5fa', '#3b82f6', '#1525FF', '#111a99']);
    expect(PACE_COLOR_RAMP).not.toContain('#ef4444');
    expect(PACE_COLOR_RAMP).not.toContain('#22c55e');
  });
});
