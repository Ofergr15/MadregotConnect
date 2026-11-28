/**
 * LIVE SHARE EXPIRY (task 178). A runner's shared live position (phone or LiveTrack) stops being
 * served — to anyone — once either of these is true:
 *
 *   1. They stopped sharing: `race_entries.sharing_stopped_at` (migration 225, PR #154) is set and
 *      the stored position is not newer than the stop. A point written after the stop can only come
 *      from a re-share (`resume: true`, which also clears the stamp), so it is served again.
 *   2. They finished more than SHARE_AFTER_FINISH_MS ago. The finish is the earliest we can vouch for:
 *        - the finish split's `recorded_at` (official/feed/watch time as it landed here), else
 *        - for a GPS-only finish (distance ≥ GPS_FINISH_MIN_M), the moment the device's own pace
 *          puts them on the line: start (at − elapsed) + elapsed × 42.195 km / distance.
 *      The estimate is only stable because the phone client stops sharing at the finish distance;
 *      a device that kept posting long after the line would keep moving it (there is one stored
 *      row, no trail, so the crossing time itself is not known). The official finish split wins.
 *
 * Read side only: this is applied where the board serializes `position`. The window rule
 * (raceWindowOpen) and the 24 h purge still apply on top; this only ends serving sooner.
 * Pure, so every case is a test.
 */
import { RACE_M } from './core';

export const SHARE_AFTER_FINISH_MS = 2 * 3600e3;
/** GPS runs long over a marathon; under this a GPS distance is not a finish (same number as PR #218). */
export const GPS_FINISH_MIN_M = 42_300;

export interface SharePosition { distance_m: number; elapsed_sec?: number | null; at: string }

/** When the runner finished, in ms, or null if we can't say they did. */
export function finishedAtMs(p: { finishRecordedAt?: string | null; position?: SharePosition | null }): number | null {
  const official = p.finishRecordedAt ? Date.parse(p.finishRecordedAt) : NaN;
  const gps = gpsFinishMs(p.position ?? null);
  const known = [official, gps ?? NaN].filter(Number.isFinite);
  return known.length ? Math.min(...known) : null;
}

function gpsFinishMs(pos: SharePosition | null): number | null {
  if (!pos || !(pos.distance_m >= GPS_FINISH_MIN_M)) return null;
  const at = Date.parse(pos.at);
  const elapsed = Number(pos.elapsed_sec);
  if (!Number.isFinite(at)) return null;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return at;
  const startMs = at - elapsed * 1000;
  return Math.round(startMs + elapsed * (RACE_M / pos.distance_m) * 1000);
}

export type ShareExpiry = 'sharing-stopped' | 'finished' | null;

/** Why this position must not be served any more, or null to serve it. */
export function shareExpired(p: {
  nowMs: number;
  position: SharePosition;
  sharingStoppedAt?: string | null;
  finishRecordedAt?: string | null;
}): ShareExpiry {
  if (p.sharingStoppedAt) {
    const stop = Date.parse(p.sharingStoppedAt);
    const at = Date.parse(p.position.at);
    if (!Number.isFinite(stop) || !Number.isFinite(at) || at <= stop) return 'sharing-stopped';
  }
  const fin = finishedAtMs({ finishRecordedAt: p.finishRecordedAt, position: p.position });
  if (fin !== null && p.nowMs > fin + SHARE_AFTER_FINISH_MS) return 'finished';
  return null;
}
