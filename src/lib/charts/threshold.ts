import { smoothPath, xAt } from './timeline';

/**
 * 7ג's "כל הטסטים" chart (mockup trainee-experience-v2): the threshold pace of every test,
 * oldest LEFT (spec G1), FASTER HIGHER (G2), so a threshold that improves climbs toward
 * today. A green line with a light fill, a dot per test, the newest one larger. Pure
 * geometry: the component draws the SVG and lays the value and month labels over it as
 * HTML.
 */

export interface ThresholdPoint { date: string; paceSec: number }

export interface ThresholdChart {
  width: number;
  height: number;
  points: Array<{ date: string; paceSec: number; x: number; y: number; newest: boolean }>;
  line: string;
  area: string;
  grid: number[];
}

export const THRESHOLD_BOX = { width: 326, height: 120, top: 22, bottom: 8, pad: 34 };

export function thresholdChart(input: ThresholdPoint[], opts: Partial<typeof THRESHOLD_BOX> = {}): ThresholdChart | null {
  const { width, height, top, bottom, pad } = { ...THRESHOLD_BOX, ...opts };
  const pts = input.filter(p => p.paceSec > 0);
  if (!pts.length) return null;
  const paces = pts.map(p => p.paceSec);
  // A few seconds of air above the fastest and below the slowest, never a flat 0-range.
  const fast = Math.min(...paces) - 6;
  const slow = Math.max(...paces) + 6;
  const y = (v: number) => top + ((v - fast) / (slow - fast)) * (height - top - bottom);
  const n = pts.length;
  const points = pts.map((p, i) => ({ ...p, x: xAt(i, n, width, pad, pad), y: y(p.paceSec), newest: i === n - 1 }));
  const xy = points.map(p => [p.x, p.y] as [number, number]);
  const line = smoothPath(xy);
  const area = n > 1 ? `${line} L${points[n - 1].x.toFixed(1)} ${height} L${points[0].x.toFixed(1)} ${height} Z` : '';
  // Three faint rules at round 15-second paces inside the range.
  const grid: number[] = [];
  for (let g = Math.ceil(fast / 15) * 15; g <= slow; g += 15) grid.push(y(g));
  return { width, height, points, line, area, grid: grid.slice(0, 4) };
}

/** Which points get a month under them: all of up to six, else the first, the last and every other. */
export function monthLabelAt(i: number, n: number): boolean {
  if (n <= 6) return true;
  return i === 0 || i === n - 1 || (i % 2 === 0 && i < n - 2);
}
