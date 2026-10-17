// Where a plan day stands against what was run on it — the profile's week card
// (Ofer, 2026-10-17, mockups/weekly-plan). Pure, so the card and its tests read
// a day the same way.

/** A day counts as done at this share of its prescribed minimum. */
export const DONE_SHARE = 0.85;

export type DayStatus = 'done' | 'partial' | 'missed' | 'today' | 'future' | 'rest';

export function dayStatus({ date, today, requiredMin, km }: {
  /** The plan day, YYYY-MM-DD. */
  date: string;
  today: string;
  /** Prescribed kilometres, optional sessions left out. */
  requiredMin: number;
  /** Run that day. */
  km: number;
}): DayStatus {
  if (date > today) return 'future';
  // A run on a rest day is still a run; it is just not measured against anything.
  if (requiredMin <= 0) return 'rest';
  if (km <= 0) return date === today ? 'today' : 'missed';
  return km >= DONE_SHARE * requiredMin ? 'done' : 'partial';
}

/** "11–17 Oct" when the week sits in one month, "27 Sep – 3 Oct" when it doesn't. */
export function weekRangeParts(weekStart: string, locale: string): { days: string; month: string } | { from: string; to: string } {
  const a = new Date(`${weekStart}T12:00:00Z`);
  const b = new Date(a);
  b.setUTCDate(a.getUTCDate() + 6);
  const month = (d: Date) => d.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' });
  if (a.getUTCMonth() === b.getUTCMonth()) return { days: `${a.getUTCDate()}–${b.getUTCDate()}`, month: month(a) };
  return { from: `${a.getUTCDate()} ${month(a)}`, to: `${b.getUTCDate()} ${month(b)}` };
}
