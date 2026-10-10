/**
 * The trainee's "לוח" (trainee-experience-v2 screens 2 and 3), the parts that are
 * arithmetic: one planned session graded the way the week strip grades it, the "▼ 6.2
 * ק״מ במקום 8" line, the rest days of a week, and the month's grid and the sentence
 * under it. Pure, clock passed in; the routes read, this decides.
 *
 * The week board and the month grid grade every session through `boardRow`, so a day
 * cannot be green in the month and yellow in its week.
 */

import { addDaysToDateStr } from '@/lib/utils';
import { complianceOf, type Compliance, type ComplianceColor } from './compliance';

/** What `boardRow` needs of an adherence row (lib/academy/report.ts WorkoutAdherenceRow). */
export interface BoardRowInput {
  date: string;
  completed: boolean;
  distance: { plannedMin: number; plannedMax: number; actual: number | null };
  duration: { planned: number; actual: number | null; estimated: boolean };
}

export interface BoardRow {
  plannedM: number | null;
  actualM: number | null;
  plannedSec: number | null;
  actualSec: number | null;
  compliance: Compliance;
}

/**
 * One planned session as the board shows it: the planned and done distance and time, and
 * its compliance colour. Measured on what the plan was written in (complianceOf): a
 * session whose time the plan never stated is judged on distance.
 */
export function boardRow(row: BoardRowInput, today: string): BoardRow {
  const plannedM = (row.distance.plannedMin + row.distance.plannedMax) / 2 || null;
  const plannedSec = row.duration.planned || null;
  return {
    plannedM,
    actualM: row.distance.actual,
    plannedSec,
    actualSec: row.duration.actual,
    compliance: complianceOf({
      date: row.date,
      today,
      completed: row.completed,
      plannedM,
      actualM: row.distance.actual,
      plannedSec,
      actualSec: row.duration.actual,
      plannedInTime: !row.duration.estimated && !(plannedM && plannedM > 0),
    }),
  };
}

/** Run, and not just "planned": what counts as done on the board. */
export function isDone(color: ComplianceColor): boolean {
  return color === 'green' || color === 'yellow' || color === 'orange';
}

/**
 * The "▼ 6.2 ק״מ במקום 8" of a session run a bit or far off the plan, in the units the
 * plan was written in (kilometres, or minutes for a session planned in time). The numbers
 * travel as text, rounded the way the row prints them; the words are the screen's.
 * Null on green, red and grey.
 */
export interface OffLine {
  caret: 'up' | 'down';
  unit: 'km' | 'min';
  actual: string;
  planned: string;
}

/** `6230` → `6.2`, `8000` → `8`. */
export function kmLabel(metres: number): string {
  const v = Math.round(metres / 100) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function offLineOf(r: BoardRow): OffLine | null {
  const c = r.compliance;
  if (!c.caret || (c.color !== 'yellow' && c.color !== 'orange')) return null;
  if (c.measure === 'time') {
    if (r.actualSec == null || !r.plannedSec) return null;
    return { caret: c.caret, unit: 'min', actual: String(Math.round(r.actualSec / 60)), planned: String(Math.round(r.plannedSec / 60)) };
  }
  if (r.actualM == null || !r.plannedM) return null;
  return { caret: c.caret, unit: 'km', actual: kmLabel(r.actualM), planned: kmLabel(r.plannedM) };
}

/** The days of the Sunday week starting `weekStart` with no planned session: the thin "מנוחה" rows. */
export function restDaysOf(weekStart: string, plannedDates: string[]): Array<{ date: string; rest: true }> {
  const planned = new Set(plannedDates);
  if (!planned.size) return [];
  return Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStart, i))
    .filter(d => !planned.has(d))
    .map(date => ({ date, rest: true as const }));
}

// ── The month (screen 3) ───────────────────────────────────────────────────────────────

/** `null`: nothing planned that day. */
export type DayColor = ComplianceColor | null;

export interface MonthDay {
  date: string;
  color: DayColor;
  /** The characterization's target race is on this day. */
  race: boolean;
  today: boolean;
  /** Kilometres run on the day's done sessions, for the summary. */
  km: number;
}

export interface MonthSummary {
  /** Days with a session run (green, yellow or orange). */
  done: number;
  /** Days that had a session up to today: done + missed. Today counts once it is run. */
  planned: number;
  km: number;
  onPlan: number;
  bitOff: number;
  farOff: number;
  missed: number;
}

const WORST_DONE: ComplianceColor[] = ['orange', 'yellow', 'green'];

/**
 * One day, one colour. A day with two sessions is graded by what was run: the worst of
 * its run sessions (a long run on plan and an evening jog cut short reads "a bit off");
 * a day with none run is missed once it has passed, else still planned.
 */
export function dayColor(colors: ComplianceColor[]): DayColor {
  if (!colors.length) return null;
  const done = colors.filter(isDone);
  if (done.length) return WORST_DONE.find(c => done.includes(c)) ?? 'green';
  return colors.includes('red') ? 'red' : 'grey';
}

/** Every date of `month` (YYYY-MM), first to last. */
export function monthDates(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** The Sunday-first grid's leading blanks: how many days of the previous month the first row shows. */
export function leadingDays(month: string): number {
  return new Date(`${month}-01T12:00:00Z`).getUTCDay();
}

/**
 * The month's days with their colours, from the graded sessions of the weeks it touches.
 * A day after today never shows a done or missed colour (it cannot have one); a past day
 * with only grey sessions cannot occur (complianceOf turns them red).
 */
export function monthDays(input: {
  month: string;
  today: string;
  sessions: Array<{ date: string; color: ComplianceColor; actualM: number | null }>;
  raceDate?: string | null;
}): MonthDay[] {
  const byDate = new Map<string, Array<{ color: ComplianceColor; actualM: number | null }>>();
  for (const s of input.sessions) {
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }
  return monthDates(input.month).map((date) => {
    const list = byDate.get(date) ?? [];
    const color = dayColor(list.map(s => s.color));
    const km = list.filter(s => isDone(s.color)).reduce((sum, s) => sum + (s.actualM ?? 0), 0) / 1000;
    return { date, color, race: !!input.raceDate && input.raceDate === date, today: date === input.today, km };
  });
}

/**
 * The line under the grid, counted from the grid itself, so it can only say what the
 * grid shows: "9 מתוך 10 אימונים · 127 ק״מ · 7 לפי התוכנית, 2 קצת שונה, 1 לא בוצע".
 */
export function monthSummary(days: MonthDay[]): MonthSummary {
  const out: MonthSummary = { done: 0, planned: 0, km: 0, onPlan: 0, bitOff: 0, farOff: 0, missed: 0 };
  let km = 0;
  for (const d of days) {
    if (!d.color || d.color === 'grey') continue;
    out.planned += 1;
    if (d.color === 'red') { out.missed += 1; continue; }
    out.done += 1;
    km += d.km;
    if (d.color === 'green') out.onPlan += 1;
    else if (d.color === 'yellow') out.bitOff += 1;
    else out.farOff += 1;
  }
  out.km = Math.round(km);
  return out;
}

/** GET /api/academy/month's answer. */
export interface MonthBoardPayload {
  month: string;
  today: string;
  days: Array<Pick<MonthDay, 'date' | 'color' | 'race' | 'today'>>;
  summary: MonthSummary;
}

export type SummaryPartKey = 'onPlan' | 'bitOff' | 'farOff' | 'missed';

/** The sentence's tail in order, only the parts that are not zero ("7 לפי התוכנית, 2 קצת שונה, 1 לא בוצע"). */
export function summaryParts(s: MonthSummary): Array<{ key: SummaryPartKey; n: number }> {
  return (['onPlan', 'bitOff', 'farOff', 'missed'] as const)
    .map(key => ({ key, n: s[key] }))
    .filter(p => p.n > 0);
}

/** The current month of `today`, and its neighbours: `2026-10` ± n. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
