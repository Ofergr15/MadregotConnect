/**
 * The caller's own stated times (athlete_pr_overrides) on the records curve.
 *
 * /api/records/progress built `series` and `mine` from the club snapshot's run-based record breaks only, while
 * /api/athletes/prs (the PR table) applies the overrides. So a runner whose best is a time they stated by hand, the
 * usual case for a race run before the watch was connected, saw it in the table and an empty chart beside it. Same
 * rule as applyPrOverrides:
 * - a stated time REPLACES the best, as in the table (overrides exist to correct a wrong best, e.g. a GPS glitch):
 *   it becomes a break on its date (or today when it has none), and run breaks faster than it are dropped, so the
 *   curve ends exactly at the time the table shows;
 * - `hidden` means "no PR yet" for that distance, so no breaks at all.
 */
export interface Break { date: string; seconds: number }
export interface OwnOverride { bucketKey: string; seconds: number | null; achievedOn: string | null; hidden: boolean }

export function withOverride(breaks: Break[], o: OwnOverride | undefined, today: string): Break[] {
  if (!o) return breaks;
  if (o.hidden || o.seconds == null) return [];
  const stated = { date: (o.achievedOn || today).slice(0, 10), seconds: o.seconds };
  return [...breaks.filter((b) => b.seconds >= stated.seconds), stated].sort((a, b) => a.date.localeCompare(b.date));
}

/** The best after merging: the fastest, its date (what `mine` reports). With an override that is the stated time. */
export function bestOf(breaks: Break[]): Break | null {
  return breaks.reduce<Break | null>((best, b) => (best == null || b.seconds < best.seconds ? b : best), null);
}
