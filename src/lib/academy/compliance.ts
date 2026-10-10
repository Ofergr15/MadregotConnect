/**
 * The colour strip down the side of every workout in the week, and the week's totals.
 *
 * TrainingPeaks' compliance colours, which is the one thing about that product coaches
 * say they would miss: the strip says how a session went before anyone reads a number.
 *
 *     green   within ±20% of the plan            (80–120%)
 *     yellow  a bit under or over, with ▼ / ▲    (50–79% · 121–150%)
 *     orange  far from it, with the caret        (< 50% · > 150%)
 *     red     not done, and the day has passed
 *     grey    not yet
 *
 * Measured on whatever the session was PLANNED in: a session written in kilometres is
 * judged on distance, one written in minutes on time. Judging a 40-minute easy run on
 * distance would grade the athlete against this app's guess of their pace.
 *
 * Today is grey until it is run: a session at 18:00 is not missed at 09:00.
 *
 * Pure, clock passed in.
 */

export type ComplianceColor = 'green' | 'yellow' | 'orange' | 'red' | 'grey';

export interface Compliance {
  color: ComplianceColor;
  /** ▲ more than planned, ▼ less. Null on green, red and grey. */
  caret: 'up' | 'down' | null;
  /** actual ÷ planned on the measure used, or null when there is nothing to divide. */
  ratio: number | null;
  measure: 'distance' | 'time' | null;
}

export interface ComplianceInput {
  date: string;
  today: string;
  completed: boolean;
  plannedM: number | null;
  actualM: number | null;
  plannedSec: number | null;
  actualSec: number | null;
  /** The plan stated a time, rather than this app estimating one. */
  plannedInTime?: boolean;
}

export function complianceOf(input: ComplianceInput): Compliance {
  const { date, today, completed } = input;
  if (!completed) {
    return date < today
      ? { color: 'red', caret: null, ratio: null, measure: null }
      : { color: 'grey', caret: null, ratio: null, measure: null };
  }

  const useTime = input.plannedInTime || !(input.plannedM && input.plannedM > 0);
  const planned = useTime ? input.plannedSec : input.plannedM;
  const actual = useTime ? input.actualSec : input.actualM;
  // Done, but nothing to compare against (an open session): it happened, and that is
  // what the athlete was asked for.
  if (!planned || planned <= 0 || actual == null) {
    return { color: 'green', caret: null, ratio: null, measure: null };
  }

  const ratio = actual / planned;
  const measure = useTime ? 'time' : 'distance';
  // Rounded to whole percent before banding, so 79.96% reads as the 80% the screen prints.
  const pct = Math.round(ratio * 100);
  if (pct >= 80 && pct <= 120) return { color: 'green', caret: null, ratio, measure };
  const caret = pct > 100 ? 'up' : 'down';
  if (pct >= 50 && pct <= 150) return { color: 'yellow', caret, ratio, measure };
  return { color: 'orange', caret, ratio, measure };
}

/** The strip's colour as the mockup draws it. */
export const COMPLIANCE_HEX: Record<ComplianceColor, string> = {
  green: '#1FA55B',
  yellow: '#E8B630',
  orange: '#EE8A3C',
  red: '#E5484D',
  grey: '#D5D6DE',
};

export interface WeekTotalsInput {
  completed: boolean;
  plannedM: number | null;
  actualM: number | null;
  plannedSec: number | null;
  actualSec: number | null;
}

export interface WeekTotals {
  plannedKm: number;
  doneKm: number;
  plannedCount: number;
  doneCount: number;
  plannedSec: number;
  doneSec: number;
}

/**
 * Planned versus done for the week: kilometres, sessions, time.
 *
 * "Done" counts what was actually run — a session run long counts its real kilometres —
 * so the bar can pass 100%, which is a true statement about the week.
 */
export function weekTotals(rows: WeekTotalsInput[]): WeekTotals {
  const out: WeekTotals = { plannedKm: 0, doneKm: 0, plannedCount: rows.length, doneCount: 0, plannedSec: 0, doneSec: 0 };
  for (const r of rows) {
    out.plannedKm += (r.plannedM ?? 0) / 1000;
    out.plannedSec += r.plannedSec ?? 0;
    if (r.completed) {
      out.doneCount += 1;
      out.doneKm += (r.actualM ?? 0) / 1000;
      out.doneSec += r.actualSec ?? 0;
    }
  }
  out.plannedKm = Math.round(out.plannedKm * 10) / 10;
  out.doneKm = Math.round(out.doneKm * 10) / 10;
  out.plannedSec = Math.round(out.plannedSec);
  out.doneSec = Math.round(out.doneSec);
  return out;
}

/** 0..1 for a meter, capped so an over-run week fills the bar rather than breaking it. */
export function meterFraction(done: number, planned: number): number {
  if (!(planned > 0)) return done > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, done / planned));
}
