// Race-live viewer fallbacks when positions stop arriving (round 6, task 147). Builds on
// viewer.ts (night task 61): a stale GPS row used to say only "not updated (3 min ago)", which
// leaves the watcher with a distance that is no longer true. Now a stale row also carries the
// last OFFICIAL split (a fact that doesn't age) and "עודכן לפני X דק׳", and the board as a whole
// says when it last heard from anyone once every position has gone stale.
//
// Pure, kept apart from viewer.ts so it composes with the finish/freeze work in flight (#218).

import { formatClock } from './core';
import { ageLabel, pointLabel, STALE_MS, type ViewerLine, type ViewerRunnerInput } from './viewer';

/** "עודכן לפני 4 דק׳". */
export function updatedLabel(ageSec: number): string {
  return `עודכן ${ageLabel(Math.max(0, Math.floor(ageSec)))}`;
}

export interface StaleDetail {
  /** The last official split, e.g. "25K · 2:01:33", or null before the first split. */
  lastSplit: string | null;
  /** "עודכן לפני 4 דק׳" — the age of the GPS position. */
  updated: string;
}

/** For a row whose GPS position went stale: what to show beside it. Null for any other row. */
export function staleDetail(r: Pick<ViewerRunnerInput, 'lastPoint' | 'lastSec'>, line: ViewerLine): StaleDetail | null {
  if (line.kind !== 'position' || !line.stale) return null;
  const lastSplit = r.lastPoint && r.lastSec != null ? `${pointLabel(r.lastPoint)} · ${formatClock(r.lastSec)}` : null;
  return { lastSplit, updated: updatedLabel(line.ageSec) };
}

export interface BoardFreshness {
  /** Newest position on the board, ms. Null when nobody has a position. */
  newestAtMs: number | null;
  ageSec: number | null;
  /** True when there ARE positions and the newest one is older than STALE_MS. */
  stale: boolean;
}

/**
 * Board-level: once no runner has posted for longer than STALE_MS (phones dead, the feed down,
 * a tunnel), the header says "עודכן לפני X דק׳" so nobody reads the board as live. Finished
 * runners don't count — they stopped sharing on purpose.
 */
export function boardFreshness(runners: Pick<ViewerRunnerInput, 'state' | 'position'>[], nowMs: number): BoardFreshness {
  let newest = -Infinity;
  for (const r of runners) {
    if (r.state === 'finished' || !r.position) continue;
    const at = Date.parse(r.position.at);
    if (Number.isFinite(at) && at > newest) newest = at;
  }
  if (!Number.isFinite(newest)) return { newestAtMs: null, ageSec: null, stale: false };
  const ageSec = Math.max(0, Math.round((nowMs - newest) / 1000));
  return { newestAtMs: newest, ageSec, stale: nowMs - newest > STALE_MS };
}
