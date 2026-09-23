/**
 * The club's week so far, for the admin home's number tiles (#71, option B).
 *
 * Every number is compared with the SAME stretch of the previous week — Sunday to
 * this weekday — never with the whole of last week. On a Monday a full last week
 * would make every tile read as a collapse.
 *
 * Pure so it can be pinned by tests; /api/admin/overview does the reads and hands
 * the rows in already reduced to Israel calendar days.
 */

export interface DayRow {
  athleteId: string;
  /** Israel calendar date, YYYY-MM-DD. */
  day: string;
}

export interface RunRow extends DayRow {
  km: number;
}

export interface Trend {
  now: number;
  prev: number;
}

export interface ClubWeek {
  weekStart: string;
  /** Members to divide by: active, non-admin rows. */
  members: number;
  activeMembers: Trend;
  km: Trend;
  runs: Trend;
  /** Members with no run in the last 7 days, today included. */
  silent7d: number;
  /** Members who opened the app this week; null when PostHog isn't configured. */
  appOpeners: Trend | null;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function summariseClubWeek({
  weekStart,
  today,
  memberIds,
  runs,
  opens,
}: {
  weekStart: string;
  today: string;
  memberIds: string[];
  runs: RunRow[];
  opens: DayRow[] | null;
}): ClubWeek {
  const members = new Set(memberIds);
  const span = daysBetween(weekStart, today);
  const prevStart = addDays(weekStart, -7);
  const prevEnd = addDays(prevStart, span);
  const silentFrom = addDays(today, -6);

  const inNow = (day: string) => day >= weekStart && day <= today;
  const inPrev = (day: string) => day >= prevStart && day <= prevEnd;

  const mine = runs.filter(r => members.has(r.athleteId));
  const now = mine.filter(r => inNow(r.day));
  const prev = mine.filter(r => inPrev(r.day));
  const km = (rows: RunRow[]) => Math.round(rows.reduce((s, r) => s + r.km, 0));
  const people = (rows: DayRow[]) => new Set(rows.map(r => r.athleteId)).size;

  const ranLately = new Set(mine.filter(r => r.day >= silentFrom && r.day <= today).map(r => r.athleteId));

  let appOpeners: Trend | null = null;
  if (opens) {
    const o = opens.filter(r => members.has(r.athleteId));
    appOpeners = { now: people(o.filter(r => inNow(r.day))), prev: people(o.filter(r => inPrev(r.day))) };
  }

  return {
    weekStart,
    members: members.size,
    activeMembers: { now: people(now), prev: people(prev) },
    km: { now: km(now), prev: km(prev) },
    runs: { now: now.length, prev: prev.length },
    silent7d: [...members].filter(id => !ranLately.has(id)).length,
    appOpeners,
  };
}
