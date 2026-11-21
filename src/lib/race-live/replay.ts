// Dry-run replay: a past-race-SHAPED dataset (SYNTHETIC — the organizer publishes no
// downloadable per-bib split file, and scraping one is what this feature avoids). Each
// profile is a plausible Valencia run, with 5 km splits and the half; replayed against
// the club's own bibs so the whole path (map → store → claim → push → feed card) runs.

import { POINT_KEYS, POINT_M, RACE_M, type FeedRunner, type PointKey, type Split } from './core';

/** Finish times (s) and fade (second-half slowdown, 1.0 = even) of a typical club field. */
export const REPLAY_PROFILES: { finishSec: number; fade: number; startOffsetSec: number; dnfAtM?: number }[] = [
  { finishSec: 2 * 3600 + 58 * 60 + 41, fade: 1.01, startOffsetSec: 0 },
  { finishSec: 3 * 3600 + 5 * 60 + 12, fade: 1.03, startOffsetSec: 120 },
  { finishSec: 3 * 3600 + 14 * 60 + 50, fade: 1.02, startOffsetSec: 300 },
  { finishSec: 3 * 3600 + 29 * 60 + 3, fade: 1.06, startOffsetSec: 540 },
  { finishSec: 3 * 3600 + 44 * 60 + 30, fade: 1.04, startOffsetSec: 900 },
  { finishSec: 3 * 3600 + 59 * 60 + 58, fade: 1.08, startOffsetSec: 1200, dnfAtM: 32000 },
];

/** A runner's full split set for one profile (chip time from their own start). */
export function profileSplits(p: (typeof REPLAY_PROFILES)[number]): Split[] {
  // First half at pace a, second at a*fade, so that total = finishSec.
  const a = p.finishSec / (RACE_M / 2 / 1000 * (1 + p.fade)) ; // s/km first half
  const at = (m: number) => (m <= RACE_M / 2 ? (m / 1000) * a : (RACE_M / 2 / 1000) * a + ((m - RACE_M / 2) / 1000) * a * p.fade);
  return POINT_KEYS.filter((k) => !p.dnfAtM || POINT_M[k] <= p.dnfAtM).map((k) => ({ point: k, elapsedSec: Math.round(at(POINT_M[k])) }));
}

/**
 * What a feed would show at `raceSec` (seconds since the gun): each runner's splits that have
 * happened by then. Bibs are assigned round-robin over the profiles.
 */
export function replayFeedAt(bibs: string[], raceSec: number): FeedRunner[] {
  return bibs.map((bib, i) => {
    const p = REPLAY_PROFILES[i % REPLAY_PROFILES.length];
    const since = raceSec - p.startOffsetSec;
    const splits = since < 0 ? [] : profileSplits(p).filter((s) => s.elapsedSec <= since);
    return { bib, splits };
  });
}

/** Race seconds for a replay that started at `startedMs` running `speed`× real time. */
export function replayRaceSec(nowMs: number, startedMs: number, speed: number): number {
  return Math.max(0, Math.floor(((nowMs - startedMs) / 1000) * Math.max(1, speed)));
}

export type { PointKey };
