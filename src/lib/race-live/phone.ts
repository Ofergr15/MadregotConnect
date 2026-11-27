/**
 * PHONE LOCATION DURING THE RACE (b24, Valencia 2026-12-06). The runner's own phone posts its latest
 * position every 60 s (120 s in Low Power Mode) while they share it. Research: review-2026-11-20/
 * valencia-live-research.md — phone tracking is the only legal source at 1–2 min freshness.
 *
 * What is stored is exactly what LiveTrack already stores: ONE row per runner in race_positions (latest
 * point, no trail), visible only to members who opted in to the map and never for an opted-out runner,
 * deleted by the existing purge 24 h after the race window (PURGE_AFTER_MS) or at once when the runner
 * stops sharing / opts out. No migration: the columns and the purge exist (196).
 *
 * Pure, so every rule below is a test.
 */
import { RACE_M } from './core';

export interface PhonePosition {
  lat: number; lon: number; distanceM: number; elapsedSec: number; at: string;
  /**
   * The phone restarted its own session (app killed, reboot, the runner stopped and re-shared)
   * and its counters began again from 0. The server continues the SAME track: see mergePhonePosition.
   */
  resume?: boolean;
}
export type PhoneReject = 'bad-body' | 'out-of-window' | 'not-on-board' | 'opted-out' | 'too-soon' | 'not-monotonic';

/**
 * Writes closer together than this are refused. Was 20 s, which silently 429'd every other point of a
 * phone posting every 10-20 s (the race-day cadence in the hardening brief): measured in
 * raceLiveRaceDay.test.ts, 481 of 961 points of a 4 h race at 15 s. 8 s still stops a retry storm
 * (25 runners → at most ~3 writes/s) and lets a 10 s cadence with GPS jitter through.
 */
export const PHONE_MIN_INTERVAL_SEC = 8;
/** A shared session ends by itself this long after the runner started (the research's 7 h cap). */
export const PHONE_MAX_ELAPSED_SEC = 7 * 3600;
/** Slack for GPS running long over a whole marathon (~1 %) plus the walk to the start. */
export const PHONE_MAX_DISTANCE_M = Math.round(RACE_M * 1.06);

/** Body → a clean position, or null. Coordinates in range, a sane distance/elapsed, a recent timestamp. */
export function parsePhonePosition(body: unknown, nowMs: number): PhonePosition | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const lat = Number(b.lat), lon = Number(b.lon), d = Number(b.distanceM), e = Number(b.elapsedSec);
  const at = typeof b.at === 'string' ? Date.parse(b.at) : NaN;
  if (![lat, lon, d, e, at].every(Number.isFinite)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (d < 0 || d > PHONE_MAX_DISTANCE_M || e < 0 || e > PHONE_MAX_ELAPSED_SEC) return null;
  // A point from the future, or older than 15 minutes (a phone that buffered all morning), is not "where they are".
  if (at > nowMs + 60_000 || at < nowMs - 15 * 60_000) return null;
  const out: PhonePosition = { lat, lon, distanceM: Math.round(d), elapsedSec: Math.round(e), at: new Date(at).toISOString() };
  if (b.resume === true) out.resume = true;
  return out;
}

/**
 * Whether this write is allowed. `cfg` = race_live_config, `entry` = the caller's own race_entries row
 * (null = not on the board), `prev` = their current race_positions row.
 */
export function phoneWriteAllowed(p: {
  nowMs: number;
  cfg: { active: boolean; poll_from: string | null; poll_to: string | null } | null;
  entry: { live_opt_out: boolean } | null;
  prev: { distance_m: number; at: string } | null;
  next: PhonePosition;
}): PhoneReject | null {
  const { cfg, entry, prev, next, nowMs } = p;
  if (!raceWindowOpen(cfg, nowMs)) return 'out-of-window';
  if (!entry) return 'not-on-board';
  if (entry.live_opt_out) return 'opted-out';
  if (prev) {
    if (Date.parse(next.at) - Date.parse(prev.at) < PHONE_MIN_INTERVAL_SEC * 1000) return 'too-soon';
    // Distance only grows; a small GPS jitter backwards is clamped by the caller, a big drop is a new
    // session — refused unless the phone SAYS it resumed, in which case mergePhonePosition continues it.
    if (!next.resume && next.distanceM + 200 < prev.distance_m) return 'not-monotonic';
  }
  return null;
}

/**
 * The race window: config active and now inside [poll_from, poll_to]. Positions are written AND read
 * only inside it — the board hides every position outside the window even before the 24 h purge runs.
 */
export function raceWindowOpen(
  cfg: { active: boolean; poll_from: string | null; poll_to: string | null } | null | undefined,
  nowMs: number,
): boolean {
  if (!cfg?.active) return false;
  if (cfg.poll_from && nowMs < Date.parse(cfg.poll_from)) return false;
  if (cfg.poll_to && nowMs > Date.parse(cfg.poll_to)) return false;
  return true;
}

/**
 * The row to store for an allowed write. Normally the phone's own numbers (distance never moves
 * backwards). On `resume` after a restarted session whose counters dropped, the new session's
 * numbers are added on top of where the track stood — `baseDistanceM` / `baseElapsedSec` — so the
 * track continues instead of jumping back to 0, and the response hands the base back so the phone
 * can keep sending cumulative numbers from then on.
 */
export function mergePhonePosition(
  prev: { distance_m: number; elapsed_sec?: number | null; at: string } | null,
  next: PhonePosition,
): { distance_m: number; elapsed_sec: number; baseDistanceM: number; baseElapsedSec: number } {
  const restarted = !!prev && !!next.resume && next.distanceM + 200 < prev.distance_m;
  if (!restarted || !prev) {
    return { distance_m: Math.max(next.distanceM, prev?.distance_m ?? 0), elapsed_sec: next.elapsedSec, baseDistanceM: 0, baseElapsedSec: 0 };
  }
  const baseDistanceM = prev.distance_m;
  // Elapsed keeps the wall clock: where the track stood plus the time since that point, never less
  // than what the phone itself reports.
  const sincePrev = Math.max(0, Math.round((Date.parse(next.at) - Date.parse(prev.at)) / 1000));
  const baseElapsedSec = (prev.elapsed_sec ?? 0) + Math.max(0, sincePrev - next.elapsedSec);
  return {
    distance_m: Math.min(PHONE_MAX_DISTANCE_M, baseDistanceM + next.distanceM),
    elapsed_sec: Math.min(PHONE_MAX_ELAPSED_SEC, baseElapsedSec + next.elapsedSec),
    baseDistanceM,
    baseElapsedSec,
  };
}

/** Finish estimate from the phone's own pace so far: elapsed × total / covered. Null before 1 km or after the line. */
export function phoneEtaSec(distanceM: number, elapsedSec: number): number | null {
  if (distanceM < 1000 || elapsedSec <= 0 || distanceM >= RACE_M) return null;
  return Math.round(elapsedSec * (RACE_M / distanceM));
}
