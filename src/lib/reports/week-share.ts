import {
  formatReportHours, formatReportPace,
  type Last7Report,
} from './last-7-days';

/**
 * Which numbers go on the shared weekly card, and how each one prints.
 *
 * Kept apart from the canvas so the list is testable in node and so the chips in
 * the sheet, the preview and the exported image are all reading ONE definition —
 * a metric that renders differently in the preview than in the file the athlete
 * posts is the one bug this feature cannot afford.
 *
 * Metres and calories are OFFERED, not assumed: Strava rows and hand-entered runs
 * carry neither, and a row of dashes on a card meant for Instagram is worse than
 * no row. `availableMetrics` therefore gates on the athlete's own week, which is
 * also why the chip list is shorter for some athletes than others.
 */
export type WeekMetricKey = 'km' | 'time' | 'pace' | 'runs' | 'elev' | 'cal';

export interface WeekMetric {
  key: WeekMetricKey;
  /** The value as it appears on the card, already formatted and rounded. */
  total: (report: Last7Report) => string;
  /** Present on the card unless the athlete turns it off. */
  defaultOn: boolean;
  /** Does this athlete's week carry the metric at all. */
  has: (report: Last7Report) => boolean;
}

export const WEEK_METRICS: WeekMetric[] = [
  {
    key: 'km',
    defaultOn: true,
    has: (r) => r.km > 0,
    total: (r) => String(Math.round(r.km * 10) / 10),
  },
  {
    key: 'time',
    defaultOn: true,
    has: (r) => r.seconds > 0,
    total: (r) => formatReportHours(r.seconds),
  },
  {
    key: 'pace',
    defaultOn: true,
    has: (r) => r.paceSeconds !== null,
    total: (r) => (r.paceSeconds ? formatReportPace(r.paceSeconds) : '–'),
  },
  {
    key: 'runs',
    defaultOn: true,
    has: (r) => r.runs > 0,
    total: (r) => String(r.runs),
  },
  {
    key: 'elev',
    defaultOn: false,
    has: (r) => r.elevation > 0,
    // Whole metres: the watch's own figure is already an estimate, and a decimal
    // on a climb reads as precision the barometer does not have.
    total: (r) => String(Math.round(r.elevation)),
  },
  {
    key: 'cal',
    defaultOn: false,
    has: (r) => r.calories > 0,
    total: (r) => String(Math.round(r.calories)),
  },
];

/** The metrics this athlete's week can actually print, in card order. */
export function availableMetrics(report: Last7Report): WeekMetric[] {
  return WEEK_METRICS.filter((m) => m.has(report));
}

/** What the sheet opens with: the four the Saturday push already reads out. */
export function defaultMetricKeys(report: Last7Report): WeekMetricKey[] {
  return availableMetrics(report).filter((m) => m.defaultOn).map((m) => m.key);
}

/**
 * The rows to draw, in the fixed order of WEEK_METRICS rather than the order the
 * athlete happened to tap the chips: the card is a report, and a report whose
 * lines move around between shares is harder to read at a glance.
 */
export function selectedMetrics(report: Last7Report, keys: WeekMetricKey[]): WeekMetric[] {
  return availableMetrics(report).filter((m) => keys.includes(m.key));
}
