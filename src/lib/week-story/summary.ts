/**
 * The weekly summary (b25, native week tab): the ACTIVITY week, Monday to Sunday — the week
 * the athlete's watch counts and the Sunday 19:00 recap push already reports (cron/tick).
 *
 * Not the story's week. `storyWindow` closes on Saturday because the story is about the plan
 * week (Sunday–Saturday); a card on the week tab that said one total while the push and the
 * watch said another is exactly the "180 vs 174.5" report that re-split the anchors
 * (CLAUDE.md, "Week starts — TWO anchors"). So the km here are Monday–Sunday, and only the
 * plan share is read against the plan week — the one that contains that Monday.
 *
 * Everything in this file is pure; `loadWeekSummary` (server.ts) feeds it.
 */
import { addDays, highlightOf, type Highlight, type WeekNumbers } from './model';

export interface SummaryWindow {
  /** Monday, YYYY-MM-DD. */
  weekStart: string;
  /** The Sunday that closes it. */
  weekEnd: string;
}

/**
 * The week the card is about while it is shown: from Sunday 19:00 (the recap push) through
 * the end of Monday, Israel time. Outside that, null — the card is gone until next Sunday.
 */
export function summaryWindow(today: string, hour: number): SummaryWindow | null {
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (wd === 0 && hour >= 19) return { weekStart: addDays(today, -6), weekEnd: today };
  if (wd === 1) return { weekStart: addDays(today, -7), weekEnd: addDays(today, -1) };
  return null;
}

/** The last activity week that has closed by `today` (for previews outside the window). */
export function lastClosedWindow(today: string, hour: number): SummaryWindow {
  const open = summaryWindow(today, hour);
  if (open) return open;
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
  const sunday = addDays(today, -wd);   // today on a Sunday before 19:00 → the previous Sunday below
  const end = wd === 0 ? addDays(today, -7) : sunday;
  return { weekStart: addDays(end, -6), weekEnd: end };
}

/** The plan week (Sunday) that contains the activity week's Monday. */
export const planWeekOfSummary = (w: SummaryWindow) => addDays(w.weekStart, -1);

export interface SummaryRun {
  day: string;
  km: number;
  seconds: number;
  /** The run's fastest whole kilometre, seconds (from its per-km splits/laps). Absent = unknown. */
  fastestKmSeconds?: number | null;
}

/**
 * "Best of the week" (task 158): the week's standout numbers. All of them read the same
 * Monday–Sunday activity week as the km above, never the plan week.
 */
export interface WeekBest {
  /** The longest single run: its local date and km. */
  longestRun: { day: string; km: number } | null;
  /** The fastest whole kilometre of any run that week, seconds per km. Null when no run had splits. */
  fastestKm: { day: string; seconds: number } | null;
  /** The longest run of consecutive days with a run, inside the week (1–7). */
  dayStreak: number;
  /**
   * Consecutive activity weeks with at least one run, this one included. Capped by the
   * loader's lookback (this week + 8 before = 9): 9 reads "9 or more".
   */
  weekStreak: number;
}

export interface SummaryPlan {
  /** Planned km of the plan week (Sunday–Saturday), 0 = no plan. */
  plannedKm: number;
  /** km run on the plan week's days, for the share. */
  km: number;
  sessionsPlanned: number;
  sessionsDone: number;
  /** Plan days (0 = Sunday) with a planned run that was missed, with their planned km. */
  missed: Array<{ dayOfWeek: number; plannedKm: number }>;
}

export interface WeekSummary {
  window: SummaryWindow;
  /** The plan week the share is read against. */
  planWeek: string;
  numbers: WeekNumbers;
  /** Per day, MONDAY first (unlike WeekNumbers.dayKm in the story, which is Sunday first). */
  dayKm: number[];
  /** Average pace over the week, seconds per km, or null. */
  paceSeconds: number | null;
  lastWeekRuns: number | null;
  missed: SummaryPlan['missed'];
  highlight: Highlight;
  best: WeekBest;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * `runs`: qualifying runs from at least eight weeks before the window through its Sunday
 * (`day` is the activity's own local date — start_time is wall-clock, see CLAUDE.md).
 */
/** A fastest-km below this is a GPS glitch, not a kilometre anyone ran (2:00/km). */
const MIN_KM_SECONDS = 120;

export function weekBest(w: SummaryWindow, runs: SummaryRun[]): WeekBest {
  const inWeek = (r: SummaryRun, start: string) => r.day >= start && r.day <= addDays(start, 6);
  const mine = runs.filter((r) => inWeek(r, w.weekStart));

  let longestRun: WeekBest['longestRun'] = null;
  let fastestKm: WeekBest['fastestKm'] = null;
  for (const r of mine) {
    // Ties go to the earlier run: the day it first happened.
    if (!longestRun || r.km > longestRun.km) longestRun = { day: r.day, km: r1(r.km) };
    const f = r.fastestKmSeconds;
    if (f != null && Number.isFinite(f) && f >= MIN_KM_SECONDS && (!fastestKm || f < fastestKm.seconds)) {
      fastestKm = { day: r.day, seconds: Math.round(f) };
    }
  }

  const ran = new Set(mine.map((r) => r.day));
  let dayStreak = 0;
  let cur = 0;
  for (let i = 0; i < 7; i++) {
    cur = ran.has(addDays(w.weekStart, i)) ? cur + 1 : 0;
    dayStreak = Math.max(dayStreak, cur);
  }

  let weekStreak = 0;
  for (let i = 0; i <= 8; i++) {
    const start = addDays(w.weekStart, -7 * i);
    if (!runs.some((r) => inWeek(r, start))) break;
    weekStreak++;
  }

  return { longestRun, fastestKm, dayStreak, weekStreak };
}

export function buildWeekSummary(opts: {
  window: SummaryWindow;
  runs: SummaryRun[];
  plan: SummaryPlan | null;
  records: WeekNumbers['records'];
  packRank: WeekNumbers['packRank'];
}): WeekSummary | null {
  const { window: w, runs, plan } = opts;
  const inWeek = (r: SummaryRun, start: string) => r.day >= start && r.day <= addDays(start, 6);
  const mine = runs.filter((r) => inWeek(r, w.weekStart));
  if (!mine.length) return null;

  const dayKm = Array.from({ length: 7 }, (_, i) => r1(mine.filter((r) => r.day === addDays(w.weekStart, i)).reduce((s, r) => s + r.km, 0)));
  const km = r1(mine.reduce((s, r) => s + r.km, 0));
  const seconds = Math.round(mine.reduce((s, r) => s + r.seconds, 0));
  const prevStart = addDays(w.weekStart, -7);
  const prev = runs.filter((r) => inWeek(r, prevStart));
  const lastKm = r1(prev.reduce((s, r) => s + r.km, 0));

  // "Biggest in N weeks": this week beats each of the up-to-eight full weeks before it.
  const before = Array.from({ length: 8 }, (_, i) => addDays(w.weekStart, -7 * (i + 1)))
    .map((start) => runs.filter((r) => inWeek(r, start)).reduce((s, r) => s + r.km, 0));
  let streak = 0;
  for (const k of before) { if (km > k) streak++; else break; }
  const biggestInWeeks = streak === before.length && before.some((k) => k > 0) ? streak + 1 : 0;

  const hasPlan = !!plan && plan.plannedKm > 0;
  const numbers: WeekNumbers = {
    km,
    runs: mine.length,
    seconds,
    // WeekNumbers.dayKm is Sunday-first by contract; the summary's own Monday-first copy is `dayKm`.
    dayKm: [dayKm[6], ...dayKm.slice(0, 6)],
    lastWeekKm: lastKm > 0 ? lastKm : null,
    planShare: hasPlan ? Math.min(1.5, plan!.km / plan!.plannedKm) : null,
    sessionsDone: hasPlan && plan!.sessionsPlanned ? plan!.sessionsDone : null,
    sessionsPlanned: hasPlan && plan!.sessionsPlanned ? plan!.sessionsPlanned : null,
    records: opts.records,
    packRank: opts.packRank,
  };
  return {
    window: w,
    planWeek: planWeekOfSummary(w),
    numbers,
    dayKm,
    paceSeconds: km > 0 ? Math.round(seconds / km) : null,
    lastWeekRuns: prev.length || null,
    missed: hasPlan ? plan!.missed : [],
    highlight: highlightOf(numbers, biggestInWeeks),
    best: weekBest(w, runs),
  };
}
