import {
  formatReportHours, formatReportPace,
  type Last7Report, type WellnessNight,
} from './last-7-days';
import type { WeekCardLang } from './week-share';
import type { ShareBrand } from '@/lib/feed/share-image';

/**
 * THE WEEKLY STORY EDITOR'S MODEL — five looks, one numbers tray.
 *
 * The rules of the approved mockup (weekly-summary-app.html, version C), kept out
 * of the canvas and the component so they can be tested in node:
 *
 *  · five looks, and each has room for a fixed number of numbers (`LOOK_CAP`);
 *  · every look keeps ITS OWN pick, so trying "minimal" and coming back does not
 *    lose the eight numbers chosen for "totals";
 *  · the tray lists every number in ONE fixed order (`NUMBER_ORDER`) whatever is
 *    picked — a tile that jumps around when another is switched on was the thing
 *    the mockup's review asked to stop (sleep "always in the same place");
 *  · the order ON THE CARD is the pick's order, changed by dragging one picked
 *    tile onto another (a swap, never an insert).
 *
 * Sleep and resting HR are on offer only when the watch recorded them, like
 * elevation and calories are only on offer when the runs carry them.
 */
export type WeekLook = 'totals' | 'days' | 'bar' | 'body' | 'minimal';
export const WEEK_LOOKS: WeekLook[] = ['totals', 'days', 'bar', 'body', 'minimal'];

export type WeekNumberKey = 'km' | 'runs' | 'time' | 'pace' | 'elev' | 'cal' | 'sleep' | 'rhr';
export const NUMBER_ORDER: WeekNumberKey[] = ['km', 'runs', 'time', 'pace', 'elev', 'cal', 'sleep', 'rhr'];

export const LOOK_CAP: Record<WeekLook, number> = { totals: 8, days: 3, bar: 4, body: 2, minimal: 1 };

/** Each look's own logo until the athlete picks another. */
export const LOOK_BRAND: Record<WeekLook, ShareBrand> = {
  totals: 'wordmark', days: 'stairs', bar: 'badge', body: 'wordmark', minimal: 'badge',
};

const LOOK_DEFAULTS: Record<WeekLook, WeekNumberKey[]> = {
  totals: ['km', 'runs', 'time', 'pace', 'elev', 'cal', 'sleep', 'rhr'],
  days: ['km', 'runs', 'pace'],
  bar: ['km', 'time', 'pace', 'runs'],
  body: ['km', 'runs'],
  minimal: ['km'],
};

export type WeekBackground = 'club' | 'sunset' | 'night' | 'photo' | 'sticker';
export const WEEK_BACKGROUNDS: WeekBackground[] = ['club', 'sunset', 'night', 'photo', 'sticker'];

export type WeekChartMetric = 'km' | 'time';

export interface WeekStoryState {
  look: WeekLook;
  picks: Record<WeekLook, WeekNumberKey[]>;
  brand: ShareBrand | null;
  title: string;
  dates: boolean;
  name: boolean;
  background: WeekBackground;
  chartMetric: WeekChartMetric;
  sleepStrip: boolean;
  avgLine: boolean;
  barValues: boolean;
  deltas: boolean;
  lang: WeekCardLang;
}

export interface WeekStoryText {
  looks: Record<WeekLook, string>;
  labels: Record<WeekNumberKey, string>;
  titles: string[];
  thisWeek: string;
  average: string;
  fromLastWeek: string;
  sleepLegend: string;
  minutes: string;
  days: string[];
}

export const WEEK_STORY_TEXT: Record<WeekCardLang, WeekStoryText> = {
  he: {
    looks: { totals: 'סיכום', days: 'יום אחרי יום', bar: 'שורת נתונים', body: 'גוף', minimal: 'מינימלי' },
    labels: {
      km: 'ק״מ', runs: 'ריצות', time: 'שעות', pace: 'קצב ממוצע', elev: 'מ׳ טיפוס',
      cal: 'קלוריות', sleep: 'שינה בממוצע', rhr: 'דופק מנוחה ממוצע',
    },
    titles: ['השבוע שלי', 'עוד שבוע בכיס', 'שבוע של מדרגות', 'בדרך למרתון'],
    thisWeek: 'השבוע',
    average: 'ממוצע',
    fromLastWeek: 'משבוע שעבר',
    sleepLegend: 'פס סגול = כמה ישנת בכל לילה, בהיר = יותר',
    minutes: '׳',
    days: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
  },
  en: {
    looks: { totals: 'Totals', days: 'Day by day', bar: 'Stats bar', body: 'Body', minimal: 'Minimal' },
    labels: {
      km: 'km', runs: 'runs', time: 'hours', pace: 'avg pace', elev: 'm climbed',
      cal: 'calories', sleep: 'avg sleep', rhr: 'avg resting HR',
    },
    titles: ['My week', 'Another week done', 'A week of Madregot', 'Road to the marathon'],
    thisWeek: 'this week',
    average: 'avg',
    fromLastWeek: 'vs last week',
    sleepLegend: 'purple strip = sleep each night, brighter = more',
    minutes: 'm',
    days: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  },
};

/** The numbers this athlete's week can print, in the tray's fixed order. */
export function availableNumbers(report: Last7Report): WeekNumberKey[] {
  const has: Record<WeekNumberKey, boolean> = {
    km: report.km > 0,
    runs: report.runs > 0,
    time: report.seconds > 0,
    pace: report.paceSeconds !== null,
    elev: report.elevation > 0,
    cal: report.calories > 0,
    sleep: !!report.sleepSeconds,
    rhr: !!report.restingHr,
  };
  return NUMBER_ORDER.filter(k => has[k]);
}

/** "Body" is a look about sleep and resting HR; without either it has nothing to show. */
export function availableLooks(report: Last7Report): WeekLook[] {
  const body = !!report.sleepSeconds || !!report.restingHr;
  return WEEK_LOOKS.filter(l => l !== 'body' || body);
}

export function initialStoryState(report: Last7Report, lang: WeekCardLang): WeekStoryState {
  const avail = availableNumbers(report);
  const picks = {} as Record<WeekLook, WeekNumberKey[]>;
  for (const look of WEEK_LOOKS) {
    const own = LOOK_DEFAULTS[look].filter(k => avail.includes(k));
    // A week without the look's own numbers still opens with something on it.
    picks[look] = (own.length ? own : avail).slice(0, LOOK_CAP[look]);
  }
  return {
    look: 'totals', picks, brand: null, title: WEEK_STORY_TEXT[lang].titles[0],
    dates: true, name: true, background: 'club', chartMetric: 'km',
    sleepStrip: true, avgLine: false, barValues: true, deltas: true, lang,
  };
}

/**
 * Tap a tile: on if there is room, off unless it is the last one on the card. A
 * look with room for ONE number swaps it instead: there the last one could never be
 * turned off, so no other could ever be turned on.
 */
export function toggleNumber(picks: WeekNumberKey[], key: WeekNumberKey, cap: number): WeekNumberKey[] {
  const i = picks.indexOf(key);
  if (i >= 0) return picks.length > 1 ? picks.filter(k => k !== key) : picks;
  if (cap === 1) return [key];
  return picks.length < cap ? [...picks, key] : picks;
}

/** Drop one picked tile on another: the two trade places, nothing else moves. */
export function swapNumbers(picks: WeekNumberKey[], a: WeekNumberKey, b: WeekNumberKey): WeekNumberKey[] {
  const i = picks.indexOf(a);
  const j = picks.indexOf(b);
  if (i < 0 || j < 0 || i === j) return picks;
  const next = [...picks];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function numberValue(report: Last7Report, key: WeekNumberKey): string {
  switch (key) {
    case 'km': return (Math.round(report.km * 10) / 10).toFixed(1);
    case 'runs': return String(report.runs);
    case 'time': return formatReportHours(report.seconds);
    case 'pace': return report.paceSeconds ? formatReportPace(report.paceSeconds) : '–';
    case 'elev': return String(Math.round(report.elevation));
    case 'cal': return Math.round(report.calories).toLocaleString('en-US');
    case 'sleep': return report.sleepSeconds ? formatReportHours(report.sleepSeconds) : '–';
    case 'rhr': return report.restingHr ? String(report.restingHr) : '–';
  }
}

/**
 * This week against the one before, for the body look's two tiles. Null when
 * either week lacks the number — a delta against nothing is not a trend.
 * `good` is the direction a runner hopes for: more sleep, a LOWER resting HR.
 */
export function bodyDelta(
  report: Last7Report,
  previous: Last7Report | null | undefined,
  key: 'sleep' | 'rhr',
): { text: string; good: boolean } | null {
  if (!previous) return null;
  if (key === 'sleep') {
    if (!report.sleepSeconds || !previous.sleepSeconds) return null;
    const d = report.sleepSeconds - previous.sleepSeconds;
    const mins = Math.round(Math.abs(d) / 60);
    if (mins === 0) return null;
    return { text: `${d > 0 ? '+' : '-'}${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`, good: d > 0 };
  }
  if (!report.restingHr || !previous.restingHr) return null;
  const d = report.restingHr - previous.restingHr;
  if (d === 0) return null;
  return { text: `${d > 0 ? '↑' : '↓'} ${Math.abs(d)}`, good: d < 0 };
}

/** Sleep per day of the window, in the report's day order; null = not recorded. */
export function nightlySleep(report: Last7Report, nights: WellnessNight[] | undefined): (number | null)[] {
  const byDate = new Map((nights ?? []).map(n => [n.date, n.sleep_seconds]));
  return report.days.map(d => byDate.get(d.date) ?? null);
}
