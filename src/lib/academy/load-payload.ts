import type { TestState } from './test-state';
import { shiftDate, thresholdOn, daysBetween, type TestPoint } from './load';
import {
  dailyLoads, loadStatus, loadWeeks, pmcSeries, pmcToday, pointOn, weekStartOf,
  type LoadRow, type LoadStatus, type StatusGate, type WeeklyLoad,
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
export { LOAD_WEEKS as WEEKS_SHOWN } from './pmc';

export interface LoadPayload {
  status: LoadStatus;
  /**
   * test-state.ts kind, read only when no usable test stands (the route's): the "הערכה לפי
   * דופק" line under HR-estimated numbers says pending / 2000 m, not "עוד אין טסט".
   */
  testKind?: TestState['kind'] | null;
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
  /** The usable test before the basis one: 7's "4:12 במקום 4:21 · מהטסט של יולי". */
  previousTest: { date: string; thresholdSec: number } | null;
  firstLoadDate: string | null;
  /**
   * Form per Sunday week over the range, oldest first (7's band strip): each week as of
   * its Saturday, this week as of yesterday. Empty while the numbers are not ok.
   */
  formWeeks: Array<{ weekStart: string; form: number; band: FormBandKey }>;
  /** The upcoming race, when there is one: 7 offers "עד המרוץ" only then. */
  raceDate: string | null;
  /**
   * Tomorrow morning's form — today's load in (0 on a rest day): the number the home
   * titles "איך אתה מגיע למחר". Screen 7 prints it beside its own "as of yesterday" form so
   * the two numbers on one morning are explained, not contradictory. Null unless ok.
   */
  formTomorrow: number | null;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function buildLoadPayload(input: {
  rows: LoadRow[];
  tests: TestPoint[];
  today: string;
  range: LoadRange;
  raceDate?: string | null;
  /**
   * Planned load (E2) per Sunday week, for the shown weeks and the 4 before them
   * (`plannedWeeksFor`): this week's dashed bar, and which weeks the coach planned easy.
   */
  plannedByWeek?: Record<string, number | undefined>;
  /** A broken data feed or runs still being priced withhold every number (pmc.ts `gateStatus`). */
  gate?: StatusGate | null;
}): LoadPayload {
  const { rows, tests, today } = input;
  const status = loadStatus(rows, today, input.gate);
  const priced = rows.filter(r => r.load != null && r.date <= today).map(r => r.date).sort();
  const firstLoadDate = priced[0] ?? null;
  const y = shiftDate(today, -1);
  const basis = thresholdOn(today, tests);
  const previous = basis ? thresholdOn(shiftDate(basis.date, -1), tests) : null;

  const historyFrom = firstLoadDate ?? today;
  const daily = dailyLoads(rows, historyFrom, today);
  const series = firstLoadDate && firstLoadDate <= y ? pmcSeries(daily.filter(d => d.date <= y)) : [];
  const weekly = loadWeeks(daily, input.plannedByWeek ?? {}, today, firstLoadDate);

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

  // One cell per Sunday week the range touches, from the full (unsampled) series.
  const formWeeks: LoadPayload['formWeeks'] = [];
  if (status.kind === 'ok' && series.length) {
    for (let w = weekStartOf(from); w <= y; w = shiftDate(w, 7)) {
      const end = shiftDate(w, 6) < y ? shiftDate(w, 6) : y;
      if (end < series[0].date) continue;
      const p = pointOn(series, end);
      const form = Math.round(p.fitness - p.fatigue);
      formWeeks.push({ weekStart: w, form, band: formBand(form).key });
    }
  }

  let todayOut: LoadPayload['today'] = null;
  let formTomorrow: number | null = null;
  if (status.kind === 'ok' && series.length) {
    const throughToday = pmcSeries(daily.filter(d => d.date <= today));
    const last = throughToday[throughToday.length - 1];
    if (last && last.date === today) formTomorrow = Math.round(last.fitness - last.fatigue);
    const t = pmcToday(series, today);
    // This week as the coach planned it (G2): "שבוע קל" rather than "מתאושש".
    const easyWeek = weekly.length ? weekly[weekly.length - 1].weekStart === weekStartOf(today) && weekly[weekly.length - 1].easy : false;
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
    previousTest: previous ? { date: previous.date, thresholdSec: previous.thresholdSec } : null,
    firstLoadDate,
    formWeeks,
    raceDate: input.raceDate && input.raceDate >= today ? input.raceDate : null,
    formTomorrow,
  };
}
