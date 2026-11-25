import { filterQualifyingRuns } from '@/lib/prs/pr-buckets';
import { activityLocalDateStr, addDaysToDateStr } from '@/lib/utils';

/**
 * The weekly board's day bars (b23 "club week"): kilometres per day of the ACTIVITY week
 * (Monday → Sunday, index 0 = Monday), for the club and for the caller.
 *
 * Same rows and the same run filter as fetchWeeklyVolume, so the seven bars add up to
 * the week's board total. The day comes from the start_time STRING (wall clock stored as
 * UTC — CLAUDE.md), never from an instant.
 */
export interface DayKmRow { athlete_id: string; start_time: string; distance: number | null; duration?: number | null; activity_type?: string | null }

const r1 = (n: number) => Math.round(n * 10) / 10;

export function dayKmOf(rows: DayKmRow[], weekStart: string, callerId: string | null): { dayKm: number[]; myDayKm: number[] } {
  const club = Array(7).fill(0) as number[];
  const mine = Array(7).fill(0) as number[];
  const index = new Map(Array.from({ length: 7 }, (_, i) => [addDaysToDateStr(weekStart, i), i]));
  for (const r of filterQualifyingRuns(rows as never[]) as unknown as DayKmRow[]) {
    const i = index.get(activityLocalDateStr(r.start_time));
    if (i == null) continue;
    const m = Number(r.distance) || 0;
    club[i] += m;
    if (callerId && r.athlete_id === callerId) mine[i] += m;
  }
  return { dayKm: club.map((m) => r1(m / 1000)), myDayKm: mine.map((m) => r1(m / 1000)) };
}

/** `weekOffset` query value: 0 (this week) or -1 (last week). Anything else is 0. */
export function parseWeekOffset(v: string | null): 0 | -1 {
  return v === '-1' ? -1 : 0;
}
