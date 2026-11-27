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
  | { kind: 'position'; text: string; stale: boolean; ageSec: number }
  | { kind: 'last_split'; text: string; stale: false }
  | { kind: 'not_started'; text: string; stale: false };

const POINT_LABEL: Record<string, string> = { start: 'זינוק', half: 'חצי', finish: 'סיום' };
export const pointLabel = (p: string) => POINT_LABEL[p] ?? p.toUpperCase();

export function viewerLine(r: ViewerRunnerInput, nowMs: number): ViewerLine {
  if (r.state === 'finished' && r.lastSec != null) return { kind: 'finished', text: `סיום · ${formatClock(r.lastSec)}`, stale: false };
  const pos = r.position;
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
