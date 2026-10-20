import type { Person, SessionDay } from '@/lib/attendance/real-server';

// The numbers the attendance screens show, from the sessions the API returns
// (mockup ~/.cache/madregot/attendance-mockup.html, Ofer 2026-10-20).

export interface AttendanceData {
  today: string;
  days: SessionDay[];
  people: Record<string, Person>;
  sizes: { 1: number; 2: number; 3: number; academy: number };
}

export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const WEEKDAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
export const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;
export const sundayOf = (iso: string) => addDays(iso, -weekdayOf(iso));

export const held = (days: SessionDay[]) => days.filter((d) => d.held && d.came.length > 0);
export const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Who came how many times across these sessions. */
export function counts(days: SessionDay[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of days) for (const id of d.came) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

/** A person's row in the screens: a pack 1–3, or the academy. */
export type Lane = 1 | 2 | 3 | 'academy';
export const laneOf = (p: Person | undefined): Lane | null => (!p ? null : p.academy ? 'academy' : (p.pack as Lane | null));
export const LANE_HEX: Record<string, string> = { 1: '#16a34a', 2: '#159AFF', 3: '#FF5315', academy: '#8E7CFF' };
export const laneLabel = (l: Lane) => (l === 'academy' ? 'אקדמיה' : `דבוקה ${l}`);

/** Average per session of one lane's people. */
export const laneAvg = (days: SessionDay[], people: Record<string, Person>, lane: Lane) =>
  avg(days.map((d) => d.came.filter((id) => laneOf(people[id]) === lane).length));

/** The last 7 days to `today`, the sessions still ahead this week, and who usually comes but didn't. */
export function week(data: AttendanceData) {
  const { today, days, people } = data;
  const last7 = held(days.filter((d) => d.date > addDays(today, -7) && d.date <= today)).sort((a, b) => b.date.localeCompare(a.date));
  const before7 = held(days.filter((d) => d.date > addDays(today, -14) && d.date <= addDays(today, -7)));
  const ahead = days.filter((d) => !d.held && d.date <= addDays(today, 6));
  const c7 = counts(last7);
  const prior = counts(held(days.filter((d) => d.date > addDays(today, -35) && d.date <= addDays(today, -7))));
  const missing = [...prior.entries()].filter(([id, n]) => n >= 3 && !c7.has(id) && people[id]?.active).map(([id, n]) => ({ id, n }));
  const weeks = new Map<string, number[]>();
  for (const d of held(days)) weeks.set(sundayOf(d.date), [...(weeks.get(sundayOf(d.date)) ?? []), d.came.length]);
  const trend = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-8).map(([w, xs]) => ({ week: w, avg: avg(xs) }));
  return {
    last7, ahead, c7, missing: missing.sort((a, b) => b.n - a.n), trend,
    average: avg(last7.map((d) => d.came.length)),
    delta: before7.length && last7.length ? avg(last7.map((d) => d.came.length)) - avg(before7.map((d) => d.came.length)) : null,
  };
}
