// The live-tracking viewer's degradation rules (night task 61). Pure, so the web
// page and any other client agree on what a row says when the data is partial.
//
//   GPS position, fresh (≤ STALE_MS old)  → "at 23.4 km · 1:52:10"
//   GPS position, older than STALE_MS     → same line, marked STALE with its age
//   no GPS (opted out, no phone, no map)  → the last official split ("25K · 2:01:33")
//   no split yet                          → not started
//   finished                              → the finish time, never stale
//
// "Stale" is about the position only: a split is a fact that doesn't age.

import { formatClock, type Split } from './core';

export const STALE_MS = 2 * 60 * 1000;
/**
 * GPS distance at or past this, with no official finish split yet → "finished per GPS".
 * 42.3 km, not 42.195 − 150 m: watches/phones measure a marathon long, so an earlier
 * threshold would announce "finished" a minute or two before the line (decision 28.11).
 */
export const GPS_FINISH_MIN_M = 42_300;
/** After the race window closes, wait this long for late official splits, then freeze. */
export const RESULTS_GRACE_MS = 30 * 60 * 1000;

export interface ViewerRunnerInput {
  state: 'not_started' | 'running' | 'finished';
  splits: Split[];
  lastPoint: string | null;
  lastSec: number | null;
  predictedSec: number | null;
  position: { distanceM: number; elapsedSec?: number | null; at: string } | null;
}

export type ViewerLine =
  | { kind: 'finished'; text: string; stale: false }
  | { kind: 'gps_finished'; text: string; stale: false }
  | { kind: 'position'; text: string; stale: boolean; ageSec: number }
  | { kind: 'last_split'; text: string; stale: false }
  | { kind: 'not_started'; text: string; stale: false };

const POINT_LABEL: Record<string, string> = { start: 'זינוק', half: 'חצי', finish: 'סיום' };
export const pointLabel = (p: string) => POINT_LABEL[p] ?? p.toUpperCase();

export function viewerLine(r: ViewerRunnerInput, nowMs: number, opts: { frozen?: boolean } = {}): ViewerLine {
  if (r.state === 'finished' && r.lastSec != null) return { kind: 'finished', text: `סיום · ${formatClock(r.lastSec)}`, stale: false };
  // Frozen results: positions no longer mean anything (the phone may still be sharing from the
  // hotel) — every unfinished runner shows the last official split, never a stale GPS line.
  const pos = opts.frozen ? null : r.position;
  if (pos && isGpsFinish(pos.distanceM)) {
    const clock = pos.elapsedSec != null ? ` · ${formatClock(pos.elapsedSec)}` : '';
    return { kind: 'gps_finished', text: `סיים/ה לפי GPS${clock} (ממתין לזמן רשמי)`, stale: false };
  }
  const at = pos ? Date.parse(pos.at) : NaN;
  if (pos && Number.isFinite(at) && Number.isFinite(pos.distanceM) && pos.distanceM >= 0) {
    const ageSec = Math.max(0, Math.round((nowMs - at) / 1000));
    const km = (pos.distanceM / 1000).toFixed(1);
    const clock = pos.elapsedSec != null ? ` · ${formatClock(pos.elapsedSec)}` : '';
    return { kind: 'position', text: `${km} ק״מ${clock}`, stale: nowMs - at > STALE_MS, ageSec };
  }
  if (r.lastPoint && r.lastSec != null) return { kind: 'last_split', text: `${pointLabel(r.lastPoint)} · ${formatClock(r.lastSec)}`, stale: false };
  return { kind: 'not_started', text: 'עוד לא יצא/ה לדרך', stale: false };
}

/** "לפני 3 דק׳" — how old a stale position is. */
export function ageLabel(ageSec: number): string {
  if (ageSec < 60) return `לפני ${ageSec} שנ׳`;
  if (ageSec < 3600) return `לפני ${Math.floor(ageSec / 60)} דק׳`;
  return `לפני ${Math.floor(ageSec / 3600)} שע׳`;
}

/** The GPS says the runner crossed the line (the official finish split may lag by minutes). */
export function isGpsFinish(distanceM: number | null | undefined): boolean {
  return typeof distanceM === 'number' && Number.isFinite(distanceM) && distanceM >= GPS_FINISH_MIN_M;
}

export type BoardPhase = 'live' | 'results';

/**
 * Live until the race window (race_live_config.poll_to) closes plus RESULTS_GRACE_MS, then
 * results: the page stops polling and the board freezes. No window end → always live.
 */
export function boardPhase(nowMs: number, windowEnd: string | null | undefined): BoardPhase {
  const end = windowEnd ? Date.parse(windowEnd) : NaN;
  if (!Number.isFinite(end)) return 'live';
  return nowMs > end + RESULTS_GRACE_MS ? 'results' : 'live';
}

/**
 * Results order: official finishers by time (ties keep board order), then everyone else by how
 * far they officially got (furthest first), then not started. Stable, so equal rows don't jump.
 */
export function resultsOrder<T extends ViewerRunnerInput>(runners: T[]): T[] {
  const rank = (r: T) => (r.state === 'finished' && r.lastSec != null ? 0 : r.splits.length ? 1 : 2);
  return runners
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ra = rank(a.r), rb = rank(b.r);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (a.r.lastSec! - b.r.lastSec!) || a.i - b.i;
      if (ra === 1) return (b.r.splits.length - a.r.splits.length) || a.i - b.i;
      return a.i - b.i;
    })
    .map(({ r }) => r);
}
