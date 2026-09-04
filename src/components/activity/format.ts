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

export function getPaceColor(pace: number, minPace: number, maxPace: number): string {
  const range = maxPace - minPace || 1;
  const ratio = (pace - minPace) / range;
  if (ratio < 0.25) return '#22c55e';
  if (ratio < 0.5) return '#eab308';
  if (ratio < 0.75) return '#f97316';
  return '#ef4444';
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
