// Profile headline numbers (night task 60): week / month / year km and the week
// streak, in ONE pure function over one athlete's activities, behind one cached
// endpoint (GET /api/athletes/[id]/headline).
//
// Anchors (CLAUDE.md "two anchors"): every number here is about the ACTIVITY
// week (Monday, the watch's week) — `activityWeekStart(start_time)` on the stored
// string, never `new Date(start_time)` in the server's zone. Month and year read
// the start_time prefix for the same reason (a 00:30 run on the 1st is the new
// month). The streak is computeWeekStreak's, the same one the leaderboard uses.

import { filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { activityWeekStart, computeWeekStreak, getActivityWeekStart, israelDateAnchor, israelToday } from '@/lib/utils';

export interface ProfileHeadline {
  /** Monday (YYYY-MM-DD) of the activity week the week numbers are for. */
  weekStart: string;
  weekKm: number;
  weekRuns: number;
  monthKm: number;
  monthRuns: number;
  yearKm: number;
  yearRuns: number;
  /** Consecutive activity weeks with ≥1 run, ending this week (or last, early in a week). */
  streakWeeks: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildProfileHeadline<T extends RunActivityRow>(acts: T[], now: Date = new Date()): ProfileHeadline {
  const today = israelToday(now);
  const weekStart = getActivityWeekStart(israelDateAnchor(now));
  const monthPrefix = today.slice(0, 8);
  const yearPrefix = today.slice(0, 5);
  let wM = 0; let wR = 0; let mM = 0; let mR = 0; let yM = 0; let yR = 0;
  const weeks = new Set<string>();
  for (const r of filterQualifyingRuns(acts)) {
    const wk = activityWeekStart(r.start_time);
    weeks.add(wk);
    if (wk === weekStart) { wM += r.distance; wR += 1; }
    if (r.start_time.startsWith(monthPrefix)) { mM += r.distance; mR += 1; }
    if (r.start_time.startsWith(yearPrefix)) { yM += r.distance; yR += 1; }
  }
  return {
    weekStart,
    weekKm: round1(wM / 1000), weekRuns: wR,
    monthKm: round1(mM / 1000), monthRuns: mR,
    yearKm: Math.round(yM / 1000), yearRuns: yR,
    streakWeeks: computeWeekStreak(weeks, now),
  };
}

/**
 * A small per-instance TTL cache. The headline is read on every profile open and
 * every tab switch back to it; 60 s of staleness is invisible there and saves a
 * paged activities walk each time. Keyed by athlete id only — the numbers are the
 * same for every viewer allowed to see them (the route checks that BEFORE reading
 * the cache, so a hit never skips the gate).
 */
export const HEADLINE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: ProfileHeadline }>();

export async function cachedHeadline(athleteId: string, load: () => Promise<ProfileHeadline>, now = Date.now()): Promise<{ value: ProfileHeadline; hit: boolean }> {
  const c = cache.get(athleteId);
  if (c && now - c.at < HEADLINE_TTL_MS) return { value: c.value, hit: true };
  const value = await load();
  cache.set(athleteId, { at: now, value });
  if (cache.size > 2000) for (const [k, v] of cache) if (now - v.at >= HEADLINE_TTL_MS) cache.delete(k);
  return { value, hit: false };
}

/** Drop one athlete's cached headline (after a sync/edit), or all of them. */
export function invalidateHeadline(athleteId?: string): void {
  if (athleteId) cache.delete(athleteId); else cache.clear();
}
