/**
 * Formatting and classification helpers for one activity. Moved out of
 * ActivityFeed unchanged so the detail page and the list agree on what a run is
 * called and which HR zone a beat count lands in.
 */
import { activityLocalHour } from '@/lib/utils';

export function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function getTimeLabel(startTime: string): string {
  const hour = activityLocalHour(startTime);
  if (hour < 6) return 'Night Run';
  if (hour < 12) return 'Morning Run';
  if (hour < 17) return 'Afternoon Run';
  return 'Evening Run';
}

export function inferRunTypeFromActivity(
  distanceKm: number,
  avgPaceSec: number | null,
): { type: string; label: string; color: string; bg: string } {
  const types: Record<string, { label: string; color: string; bg: string }> = {
    long_run: { label: 'Long Run', color: 'text-purple-600', bg: 'bg-purple-500/15' },
    tempo: { label: 'Tempo', color: 'text-band-3', bg: 'bg-band-3/15' },
    intervals: { label: 'Intervals', color: 'text-accent-red', bg: 'bg-accent-red/15' },
    easy: { label: 'Easy', color: 'text-accent-600', bg: 'bg-accent-600/15' },
    recovery: { label: 'Recovery', color: 'text-ink-400', bg: 'bg-ink-300/15' },
  };

  if (distanceKm >= 16) return { type: 'long_run', ...types.long_run };
  if (avgPaceSec && avgPaceSec < 270 && distanceKm >= 8) return { type: 'tempo', ...types.tempo };
  if (avgPaceSec && avgPaceSec < 290 && distanceKm >= 6 && distanceKm < 14)
    return { type: 'intervals', ...types.intervals };
  if (distanceKm < 7 && avgPaceSec && avgPaceSec > 330)
    return { type: 'recovery', ...types.recovery };
  return { type: 'easy', ...types.easy };
}

export function getHRZone(
  hr: number,
  maxHR = 190,
): { zone: number; label: string; color: string; bgColor: string } {
  const pct = hr / maxHR;
  if (pct < 0.6) return { zone: 1, label: 'Easy', color: 'text-ink-400', bgColor: '#969696' };
  if (pct < 0.7) return { zone: 2, label: 'Aerobic', color: 'text-band-2', bgColor: '#60a5fa' };
  if (pct < 0.8) return { zone: 3, label: 'Tempo', color: 'text-accent-600', bgColor: '#16a34a' };
  if (pct < 0.9) return { zone: 4, label: 'Threshold', color: 'text-band-3', bgColor: '#fb923c' };
  return { zone: 5, label: 'VO2max', color: 'text-accent-red', bgColor: '#D74E4E' };
}

/**
 * The pace ramp, fast → slow: green, teal, sky, blue.
 *
 * It started as green → yellow → orange → red, which is the obvious choice and
 * the wrong one here:
 *  - **Red/green is the one pair ~8% of men cannot separate**, and this is a
 *    running club. A green-to-blue ramp stays readable under both common forms of
 *    colour blindness, because it varies in hue *and* in lightness.
 *  - **Red already means something in this app** — the end-of-route marker, zone 5,
 *    the bad side of every stat. Painting the slowest kilometre in it passes a
 *    judgement the app has no business passing: a recovery kilometre is *supposed*
 *    to be slow, and so is the last one of a long run.
 *
 * Also the direction of travel matters more than the exact hues: what a reader
 * needs from the line is "this part was faster than that part", and a single-family
 * ramp reads as an ordered scale rather than four unrelated states.
 */
export const PACE_COLOR_RAMP = ['#22c55e', '#14b8a6', '#0ea5e9', '#2563eb'] as const;

/**
 * A pace's colour, normalised against the fastest and slowest split of the *same*
 * run — so an interval session and a recovery jog both use the whole ramp.
 *
 * Derived from `PACE_COLOR_RAMP` rather than repeating its hexes, so the legend
 * and the line can't drift apart.
 */
export function getPaceColor(pace: number, minPace: number, maxPace: number): string {
  const range = maxPace - minPace || 1;
  const ratio = (pace - minPace) / range;
  // The slowest split lands exactly on 1.0, which would index one past the end.
  const step = Math.min(
    PACE_COLOR_RAMP.length - 1,
    Math.floor(ratio * PACE_COLOR_RAMP.length),
  );
  return PACE_COLOR_RAMP[step];
}

/** One stretch of a route, and the colour its pace earns it. */
export interface PaceSegment {
  /** Inclusive start index into the route's points. */
  start: number;
  /** Exclusive end index — use `points.slice(start, end)`. */
  end: number;
  color: string;
}

/**
 * Cuts a route into one coloured stretch per split, for a Garmin-style pace heat
 * map. Shared by the interactive detail map and the feed thumbnail so the two
 * can't disagree about which kilometre is which colour.
 *
 * The route's points carry no timing of their own (`gps_points` is lat/lng only),
 * so the only way to place a split on the line is by fraction of the point
 * count — every split gets the same share of the geometry. That is an
 * approximation: a walked kilometre has fewer metres and roughly the same number
 * of samples, so its band is drawn slightly long. It's the same approximation
 * Garmin's own colour-by-pace makes, and it's invisible at any zoom a phone
 * shows.
 *
 * Boundaries are rounded rather than floored, and each segment reaches one point
 * into the next, so bands join without a hairline gap and the last split doesn't
 * inherit the whole rounding remainder (the previous inline version divided with
 * `Math.floor` and handed the leftover — up to a full split's worth of line — to
 * the final kilometre).
 *
 * `null` when there's nothing meaningful to colour: fewer than two splits, or a
 * line too short to cut.
 */
export function paceSegments(pointCount: number, paces: number[]): PaceSegment[] | null {
  const valid = paces.filter((p) => Number.isFinite(p) && p > 0);
  if (valid.length !== paces.length || paces.length < 2) return null;
  if (pointCount < paces.length + 1) return null;

  const minPace = Math.min(...paces);
  const maxPace = Math.max(...paces);

  const segments: PaceSegment[] = [];
  for (let i = 0; i < paces.length; i++) {
    const start = Math.round((i * pointCount) / paces.length);
    const boundary = Math.round(((i + 1) * pointCount) / paces.length);
    const end = Math.min(pointCount, boundary + 1);
    if (end - start < 2) continue;
    segments.push({ start, end, color: getPaceColor(paces[i], minPace, maxPace) });
  }
  return segments.length > 1 ? segments : null;
}

export function catmullRom(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return '';
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}
