import type { WeekSession } from './workout-parsing';

/**
 * A distance as it is SHOWN — one decimal.
 *
 * A `WeekSession` carries its kilometres raw on purpose: nine sessions each
 * rounded up a decimal stop adding up to the week they belong to. So the
 * rounding happens once, here, at the edge where a number becomes text — which
 * is also what keeps "39.400000000000006 km" off the screen.
 */
export const roundKm = (km: number) => Math.round(km * 10) / 10;

const round1 = roundKm;

/**
 * Legend/colour order. Not the chronological order the sessions come in, so the
 * legend under the chart doesn't reshuffle itself from week to week.
 */
const LEGEND_ORDER = ['long_run', 'intervals', 'tempo', 'fartlek', 'progressive', 'easy', 'rest'];

export interface WeekStats {
  kmMin: number;
  kmMax: number;
  sessionCount: number;
  /** Days that hold at least one session — 7 sessions can live on 5 days. */
  dayCount: number;
  /** The longest single SESSION, and the day it is run on. */
  longestKm: number;
  longestDayOfWeek: number;
  optionalKmMin: number;
  optionalKmMax: number;
  optionalDays: number[];
  /** Types present this week, in `LEGEND_ORDER`. */
  types: string[];
  /** A session with no distance at all (a "30-40 min easy or strength" evening). */
  hasKmlessSession: boolean;
}

/**
 * The three numbers at the top of the Plan tab, off the session list.
 *
 * `longestKm` is the longest single session on purpose. Taking it from
 * `dailyDistances` reported 41.1 km for a Tuesday that is a 24.5 km morning and
 * a 16.6 km optional evening — a distance nobody in the club runs in one go, on
 * a day nobody runs it. The week total still sums every session, because that IS
 * a sum; a single session's length is not.
 */
export function weekStats(sessions: WeekSession[]): WeekStats {
  let kmMin = 0;
  let kmMax = 0;
  let longestKm = 0;
  let longestDayOfWeek = -1;
  let optionalKmMin = 0;
  let optionalKmMax = 0;
  let hasKmlessSession = false;
  const optionalDays: number[] = [];
  const days = new Set<number>();
  const types: string[] = [];

  for (const s of sessions) {
    kmMin += s.kmMin;
    kmMax += s.kmMax;
    days.add(s.dayOfWeek);
    if (!types.includes(s.type)) types.push(s.type);
    if (s.kmMax <= 0) hasKmlessSession = true;
    if (s.kmMax > longestKm) {
      longestKm = s.kmMax;
      longestDayOfWeek = s.dayOfWeek;
    }
    if (s.optional) {
      optionalKmMin += s.kmMin;
      optionalKmMax += s.kmMax;
      if (!optionalDays.includes(s.dayOfWeek)) optionalDays.push(s.dayOfWeek);
    }
  }

  return {
    kmMin: round1(kmMin),
    kmMax: round1(kmMax),
    sessionCount: sessions.length,
    dayCount: days.size,
    longestKm: round1(longestKm),
    longestDayOfWeek,
    optionalKmMin: round1(optionalKmMin),
    optionalKmMax: round1(optionalKmMax),
    optionalDays,
    types: types.sort((a, b) => LEGEND_ORDER.indexOf(a) - LEGEND_ORDER.indexOf(b)),
    hasKmlessSession,
  };
}

export interface ChartSegment {
  key: string;
  type: string;
  optional: boolean;
  heightPx: number;
}

export interface ChartColumn {
  dayOfWeek: number;
  hasWorkout: boolean;
  /** More than one session, so the column's label carries a "+". */
  multi: boolean;
  /** The day's first session — the number written above the column. */
  leadKm: number;
  segments: ChartSegment[];
}

export interface ChartOptions {
  /** Pixels available for the tallest column. */
  heightPx: number;
  minBarPx?: number;
  /** A session with no distance still gets a stub, or it would vanish. */
  kmlessBarPx?: number;
}

/**
 * Seven columns, one per weekday, each session its own segment in the stack.
 *
 * One bar per DAY is what hid Monday's and Tuesday's evening runs: two sessions
 * became one block and there was nothing on the screen to say a second run
 * existed. The scale is set by the heaviest day rather than the longest session,
 * so a stacked double day still fits inside the box it is drawn in.
 */
export function weekChart(sessions: WeekSession[], opts: ChartOptions): ChartColumn[] {
  const { heightPx, minBarPx = 6, kmlessBarPx = 5 } = opts;
  const byDay = new Map<number, WeekSession[]>();
  for (const s of sessions) {
    const list = byDay.get(s.dayOfWeek);
    if (list) list.push(s);
    else byDay.set(s.dayOfWeek, [s]);
  }

  const peak = Math.max(
    1,
    ...[...byDay.values()].map((list) => list.reduce((sum, s) => sum + s.kmMax, 0)),
  );
  const scale = heightPx / peak;

  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const list = byDay.get(dayOfWeek) || [];
    return {
      dayOfWeek,
      hasWorkout: list.length > 0,
      multi: list.length > 1,
      leadKm: round1(list[0]?.kmMax ?? 0),
      segments: list.map((s) => ({
        key: s.key,
        type: s.type,
        optional: s.optional,
        heightPx: s.kmMax > 0 ? Math.max(minBarPx, Math.round(s.kmMax * scale)) : kmlessBarPx,
      })),
    };
  });
}

/**
 * Words a session's NAME repeats from the badges around it, so they are not
 * printed twice: "יום שלישי - ערב אופציה" is already a day header, a moon icon
 * and an "optional" pill.
 */
const REDUNDANT_NAME_WORDS = [
  'בוקר', 'ערב', 'אופציה', 'אופציונלי', 'אופציונאלי',
  'morning', 'evening', 'optional', 'part',
];

/**
 * Whatever the coach wrote in a session's name that is NOT the day, the time of
 * day or an "optional" marker — "ITALIAN MEDIO" out of "יום שישי - ITALIAN MEDIO".
 *
 * Almost every name in the program is just its weekday, which is why the name
 * can't be the card's title. But Friday's carries the one word that says what
 * the session IS, and dropping it is how a 32 km Italian medio came to read as
 * a plain "20 ק״מ".
 */
export function nameQualifier(name: string, dayNames: string[] = []): string {
  let rest = (name || '').trim().replace(/^(?:יום|day)\s+\S+/i, '');
  // `split`/`join` rather than a RegExp: a translated day name is data, and
  // data with a `(` in it must not become a pattern.
  for (const day of dayNames) {
    if (day && rest.includes(day)) rest = rest.split(day).join(' ');
  }
  return rest
    .split(/[-–—|,·:]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.split(/\s+/).every((word) => REDUNDANT_NAME_WORDS.includes(word.toLowerCase())))
    .join(' · ');
}
