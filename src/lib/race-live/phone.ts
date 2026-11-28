/**
 * PHONE LOCATION DURING THE RACE (b24, Valencia 2026-12-06). The runner's own phone posts its latest
 * position every 60 s (120 s in Low Power Mode) while they share it. Research: review-2026-11-20/
 * valencia-live-research.md — phone tracking is the only legal source at 1–2 min freshness.
 *
 * What is stored is exactly what LiveTrack already stores: ONE row per runner in race_positions (latest
 * point, no trail), visible only to members who opted in to the map and never for an opted-out runner,
 * deleted by the existing purge 24 h after the race window (PURGE_AFTER_MS) or at once when the runner
 * stops sharing / opts out. The stop itself is durable (race_entries.sharing_stopped_at, 225) so the
 * LiveTrack poller cannot write the row back.
 *
 * Pure, so every rule below is a test.
 */
import { RACE_M } from './core';

export interface PhonePosition { lat: number; lon: number; distanceM: number; elapsedSec: number; at: string }
export type PhoneReject = 'bad-body' | 'out-of-window' | 'not-on-board' | 'opted-out' | 'sharing-stopped' | 'too-soon' | 'not-monotonic';

/** Writes closer together than this are refused (the client posts every 60 s; 20 s covers retries). */
export const PHONE_MIN_INTERVAL_SEC = 20;
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
  return { lat, lon, distanceM: Math.round(d), elapsedSec: Math.round(e), at: new Date(at).toISOString() };
}

/**
 * Whether this write is allowed. `cfg` = race_live_config, `entry` = the caller's own race_entries row
 * (null = not on the board), `prev` = their current race_positions row.
 */
export function phoneWriteAllowed(p: {
  nowMs: number;
  cfg: { active: boolean; poll_from: string | null; poll_to: string | null } | null;
  entry: { live_opt_out: boolean; sharing_stopped_at?: string | null } | null;
  prev: { distance_m: number; at: string; source?: string | null } | null;
  next: PhonePosition;
  /** An explicit "share again" from the runner: the only thing that lifts a stop (Q26-5). */
  resume?: boolean;
}): PhoneReject | null {
  const { cfg, entry, next, nowMs } = p;
  // The watch (LiveTrack) writes the same row; only the phone's own previous point is a rate/monotonic
  // baseline, or a fresh watch point makes the phone's next write a false 429/403. A row with no source
  // (pre-225) keeps the old behaviour.
  const prev = p.prev && p.prev.source !== 'livetrack' ? p.prev : null;
  if (!cfg?.active) return 'out-of-window';
  if (cfg.poll_from && nowMs < Date.parse(cfg.poll_from)) return 'out-of-window';
  if (cfg.poll_to && nowMs > Date.parse(cfg.poll_to)) return 'out-of-window';
  if (!entry) return 'not-on-board';
  if (entry.live_opt_out) return 'opted-out';
  if (entry.sharing_stopped_at && !p.resume) return 'sharing-stopped';
  if (prev) {
    if (Date.parse(next.at) - Date.parse(prev.at) < PHONE_MIN_INTERVAL_SEC * 1000) return 'too-soon';
    // Distance only grows; a small GPS jitter backwards is clamped by the caller, a big drop is a new session.
    if (next.distanceM + 200 < prev.distance_m) return 'not-monotonic';
  }
  return null;
}

/** Finish estimate from the phone's own pace so far: elapsed × total / covered. Null before 1 km or after the line. */
export function phoneEtaSec(distanceM: number, elapsedSec: number): number | null {
  if (distanceM < 1000 || elapsedSec <= 0 || distanceM >= RACE_M) return null;
  return Math.round(elapsedSec * (RACE_M / distanceM));
}

/**
 * Q26-5: whether a runner's position may be written or shown at all. One rule for every
 * race_positions writer (phone POST, pollLiveTrack) and for liveBoard.
 */
export function positionSharingOn(entry: { live_opt_out?: boolean | null; sharing_stopped_at?: string | null } | null | undefined): boolean {
  return !!entry && !entry.live_opt_out && !entry.sharing_stopped_at;
}
