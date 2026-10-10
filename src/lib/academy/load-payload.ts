import { shiftDate, thresholdOn, daysBetween, type TestPoint } from './load';
import {
  dailyLoads, lastWeeks, loadStatus, pmcSeries, pmcToday, weeklyLoads,
  type LoadRow, type LoadStatus, type WeeklyLoad,
} from './pmc';
import { formBand, rampWord, type FormBandKey, type RampWordKey } from './form-bands';

/**
 * GET /api/academy/load's answer, built from the rows the route read (pure, so the
 * numbers are tested without a database). Screens 3, 7, 7ב and the coach's C2 draw it.
 */

export type LoadRange = '6w' | '3m' | 'race';
export const LOAD_RANGES: readonly LoadRange[] = ['6w', '3m', 'race'];

/** How far each range reaches back, and how densely it is sampled. */
const RANGE_DAYS: Record<Exclude<LoadRange, 'race'>, number> = { '6w': 42, '3m': 91 };
const SAMPLE_EVERY: Record<LoadRange, number> = { '6w': 1, '3m': 3, race: 3 };
/** The race range starts this long before the race (16 weeks of build). */
export const RACE_BUILD_DAYS = 16 * 7;
export const WEEKS_SHOWN = 8;

export interface LoadPayload {
  status: LoadStatus;
  range: LoadRange;
  /** As of yesterday; null while learning or with insufficient data (never a 0). */
  today: {
    fitness: number; fatigue: number; form: number; ramp: number;
    band: FormBandKey; rampWord: RampWordKey;
  } | null;
  /** Oldest first, ending yesterday. */
  series: Array<{ date: string; fitness: number; fatigue: number }>;
  weekly: WeeklyLoad[];
  thresholdSec: number | null;
  basisTestDate: string | null;
  firstLoadDate: string | null;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function buildLoadPayload(input: {
  rows: LoadRow[];
  tests: TestPoint[];
  today: string;
  range: LoadRange;
  raceDate?: string | null;
  /** Planned load of this week (E2), when it has a plan. */
  plannedThisWeek?: number | null;
}): LoadPayload {
  const { rows, tests, today } = input;
  const status = loadStatus(rows, today);
  const priced = rows.filter(r => r.load != null && r.date <= today).map(r => r.date).sort();
  const firstLoadDate = priced[0] ?? null;
  const y = shiftDate(today, -1);
  const basis = thresholdOn(today, tests);

  const weeks = lastWeeks(today, WEEKS_SHOWN);
  const historyFrom = firstLoadDate ?? today;
  const daily = dailyLoads(rows, historyFrom, today);
  const series = firstLoadDate && firstLoadDate <= y ? pmcSeries(daily.filter(d => d.date <= y)) : [];

  const priorWeeks = [4, 3, 2, 1].map(k => shiftDate(weeks[0], -7 * k));
  const priorDone = priorWeeks
    .filter(w => firstLoadDate != null && shiftDate(w, 6) >= firstLoadDate)
    .map(w => daily.reduce((s, d) => (d.date >= w && d.date <= shiftDate(w, 6) ? s + d.load : s), 0));
  const thisWeek = weeks[weeks.length - 1];
  const weekly = weeklyLoads(daily, { [thisWeek]: input.plannedThisWeek ?? undefined }, weeks, priorDone, today)
    // A week before the first priced run is not a 0, it is no data: drop it.
    .filter(w => firstLoadDate != null && shiftDate(w.weekStart, 6) >= firstLoadDate);

  let range = input.range;
  let from: string;
  if (range === 'race') {
    const race = input.raceDate && input.raceDate >= today ? input.raceDate : null;
    if (race) {
      const build = shiftDate(race, -RACE_BUILD_DAYS);
      from = firstLoadDate && firstLoadDate > build ? firstLoadDate : build;
    } else {
      range = '3m';
      from = shiftDate(y, -RANGE_DAYS['3m']);
    }
  } else {
    from = shiftDate(y, -RANGE_DAYS[range]);
  }
  const every = SAMPLE_EVERY[range];
  const sampled = series.filter(p => p.date >= from && daysBetween(p.date, y) % every === 0);

  let todayOut: LoadPayload['today'] = null;
  if (status.kind === 'ok' && series.length) {
    const t = pmcToday(series, today);
    const easyWeek = weekly.length ? weekly[weekly.length - 1].easy : false;
    todayOut = {
      fitness: Math.round(t.fitness),
      fatigue: Math.round(t.fatigue),
      form: Math.round(t.form),
      ramp: Math.round(t.ramp),
      band: formBand(t.form).key,
      rampWord: rampWord(t.ramp, { easyWeek }).key,
    };
  }

  return {
    status,
    range,
    today: todayOut,
    series: sampled.map(p => ({ date: p.date, fitness: r1(p.fitness), fatigue: r1(p.fatigue) })),
    weekly,
    thresholdSec: basis?.thresholdSec ?? null,
    basisTestDate: basis?.date ?? null,
    firstLoadDate,
  };
}
