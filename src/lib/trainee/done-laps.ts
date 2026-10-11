import type { WorkoutDone } from '@/lib/academy/workout-extras';
import type { WorkoutSheet } from '@/lib/academy/workout-sheet';

// ── 5's "הקפות" tab: the laps as a table, in screen 5's own terms ──────────────────────
//
// The same reps and the same range the reps chart above draws (done.reps against the watch
// range), so the tab can never say "100% דיוק, ✓ בתוכנית" about a rep the chart marked ▲
// faster. A run with no reps lists its kilometres against the sheet's band. Rep 1 is the
// first row, as it is the first (right-hand) bar of the chart.

export interface DoneLapRow {
  /** 1-based, as the chart numbers them. */
  n: number;
  paceSec: number;
  tone: 'in' | 'fast' | 'slow';
}

export interface DoneLaps {
  mode: 'reps' | 'km';
  rows: DoneLapRow[];
  band: { min: number; max: number } | null;
}

export function doneLaps(done: WorkoutDone | null | undefined, chart: WorkoutSheet['chart'] | null | undefined): DoneLaps | null {
  if (done && done.reps.length > 0 && done.band) {
    return { mode: 'reps', rows: done.reps.map((r, i) => ({ n: i + 1, paceSec: r.paceSec, tone: r.tone })), band: done.band };
  }
  if (chart && chart.mode === 'km' && chart.points.length > 0) {
    return {
      mode: 'km',
      rows: chart.points.map((p, i) => ({ n: i + 1, paceSec: p.pace, tone: p.kind === 'fast' ? 'fast' : p.kind === 'slow' ? 'slow' : 'in' })),
      band: { min: chart.bandMin, max: chart.bandMax },
    };
  }
  return null;
}
