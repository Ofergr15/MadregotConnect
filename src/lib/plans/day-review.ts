import type { ParsedWorkout } from '@/lib/ai/types';
import { auditWorkout, countWarnings, type AuditFinding } from './workout-audit';
import {
  isEstimate,
  stepDistanceRange,
  weakest,
  type EstimateOptions,
  type Provenance,
} from './step-estimate';
import { planDayKey } from './workout-parsing';

/**
 * The week broken into the seven days the coach reviews one at a time, and the
 * one check that can actually catch a misread day.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `workoutDistanceEstimate` answers "how far is this session?" and answers it
 * with `distanceMinKm–distanceMaxKm` whenever those exist — which is right for
 * every screen an athlete sees, because that range is what the coach wrote on
 * the plan. It is useless as a CHECK, though: those two fields are copied
 * straight off the document's own day header at parse time, so comparing them to
 * the day header compares a number to itself and prints a ✓ on a day whose steps
 * were read wrong.
 *
 * The check that works is the other direction — add up the STEPS (a time and a
 * pace multiply into a distance) and hold the total against the header the coach
 * wrote. On the week of 12.07 five of seven days state a time and no km, and all
 * five land inside their own header once multiplied out; the days that don't land
 * are exactly the days something was dropped. That is the whole value here, so it
 * is a module with tests rather than arithmetic inside a component.
 *
 * Words stay in `messages/*.json` — same rule as `workout-audit`.
 */

/** Kilometres, one decimal. Not metres: this is the coach's own unit. */
export interface KmRange {
  min: number;
  max: number;
}

export type DayCheck =
  /** The steps multiply out to something inside the header the coach wrote. */
  | 'match'
  /** They add up to less — something on the day was dropped or truncated. */
  | 'below'
  /** They add up to more — usually another day's work filed onto this one. */
  | 'above'
  /** No header, or no step carries enough to multiply. Nothing to hold it against. */
  | 'unchecked'
  /** No session at all on the day. */
  | 'rest';

/**
 * How far off the header a day may land and still read as agreeing.
 *
 * Half a kilometre, because the multiplication's own inputs are that coarse: a
 * 50-minute run at 4:50–5:30 is 9.1–10.3 km, and a pace band read off the week
 * rather than the day moves that by a few hundred metres. A tighter tolerance
 * would flag arithmetic noise as a misread day, which is the fastest way to get
 * a check ignored.
 */
const TOLERANCE_KM = 0.5;

const round1 = (n: number) => Math.round(n * 10) / 10;
const kmOf = (meters: number) => round1(meters / 1000);

function addKm(a: KmRange | null, b: KmRange | null): KmRange | null {
  if (!a) return b;
  if (!b) return a;
  return { min: round1(a.min + b.min), max: round1(a.max + b.max) };
}

/** The km range printed on the plan itself, or null where the day header had none. */
export function headerKm(workout: ParsedWorkout): KmRange | null {
  const low = workout.distanceMinKm;
  const high = workout.distanceMaxKm;
  if (!low && !high) return null;
  return { min: round1(low || high || 0), max: round1(high || low || 0) };
}

export interface DerivedKm {
  range: KmRange | null;
  from: Provenance;
}

/**
 * The session's distance built from its STEPS, deliberately ignoring
 * `distanceMinKm` — the number that makes the check a check.
 *
 * `assumeOpenBlocks` is deliberately NOT passed through: crediting an
 * information-free warmup with a nominal 2 km is exactly how a day that lost its
 * warmup comes out agreeing with its header.
 */
export function derivedKm(workout: ParsedWorkout, opts: EstimateOptions = {}): DerivedKm {
  let min = 0;
  let max = 0;
  let counted = 0;
  let from: Provenance = 'coach';
  for (const step of workout.steps || []) {
    const r = stepDistanceRange(step, opts);
    // A `none` step is almost always the zero-length wrapper a repeat block
    // hangs off, not a missing figure — skip it rather than let it drag the
    // whole day to `none`. Steps that genuinely lost their content are the
    // audit's job to name.
    if (r.from === 'none') continue;
    min += r.range.min;
    max += r.range.max;
    counted += 1;
    from = weakest(from, r.from);
  }
  if (!counted) return { range: null, from: 'none' };
  return { range: { min: kmOf(min), max: kmOf(max) }, from };
}

/** Overlap, within tolerance, between what the steps say and what the header says. */
export function compareKm(header: KmRange | null, derived: KmRange | null): DayCheck {
  if (!header || !derived) return 'unchecked';
  if (derived.max < header.min - TOLERANCE_KM) return 'below';
  if (derived.min > header.max + TOLERANCE_KM) return 'above';
  return 'match';
}

export interface SessionReview {
  workout: ParsedWorkout;
  /** Index into a group's `workouts` — the same index the editor and preview use. */
  index: number;
  /** `auditWeek`'s own key for the session. */
  key: string;
  findings: AuditFinding[];
  warnings: number;
  headerKm: KmRange | null;
  derived: DerivedKm;
  /** True when the km on screen came out of a multiplication, so it wears a `~`. */
  estimated: boolean;
}

export interface DayReview {
  dayOfWeek: number;
  /** ISO date, for the d/M beside the day's name. */
  dateKey: string;
  sessions: SessionReview[];
  /** What the coach wrote in the document's day header. */
  headerKm: KmRange | null;
  /** Prescribed sessions, from their steps. */
  derivedKm: KmRange | null;
  /** Offered sessions ("ערב אופציה"), kept OUT of the day's total on purpose. */
  optionalKm: KmRange | null;
  /** What will reach the athletes: the header where the coach wrote one. */
  publishKm: KmRange | null;
  publishFrom: 'header' | 'derived' | 'none';
  check: DayCheck;
  warnings: number;
}

/** The audit key for a session — `auditWeek` files its findings under this. */
export function sessionKey(workout: ParsedWorkout, index: number): string {
  return workout.workoutKey || `day-${workout.dayOfWeek}-part-${workout.partIndex ?? index + 1}`;
}

/**
 * The day's own header km.
 *
 * A day split into parts carries the SAME header on every part, because the
 * parser copies the day header onto each — so summing them double-counts a
 * Tuesday that happens to be stored as two rows. Identical ranges collapse to
 * one; genuinely different ones (a morning with its own km and an evening with
 * its own) add up.
 */
function dayHeaderKm(sessions: SessionReview[]): KmRange | null {
  const written = sessions
    .filter((s) => !s.workout.optional)
    .map((s) => s.headerKm)
    .filter((r): r is KmRange => !!r);
  if (!written.length) return null;
  const seen = new Set<string>();
  let total: KmRange | null = null;
  for (const range of written) {
    const id = `${range.min}-${range.max}`;
    if (seen.has(id)) continue;
    seen.add(id);
    total = addKm(total, range);
  }
  return total;
}

export function reviewDay(
  dayOfWeek: number,
  weekStartDate: string,
  workouts: ParsedWorkout[],
  opts: EstimateOptions = {},
): DayReview {
  const sessions: SessionReview[] = workouts
    .map((workout, index) => ({ workout, index }))
    .filter((s) => s.workout.dayOfWeek === dayOfWeek)
    .map(({ workout, index }) => {
      const findings = auditWorkout(workout, opts);
      const derived = derivedKm(workout, opts);
      return {
        workout,
        index,
        key: sessionKey(workout, index),
        findings,
        warnings: countWarnings(findings),
        headerKm: headerKm(workout),
        derived,
        estimated: isEstimate(derived.from),
      };
    });

  const prescribed = sessions.filter((s) => !s.workout.optional);
  const offered = sessions.filter((s) => s.workout.optional);

  const header = dayHeaderKm(sessions);
  const derived = prescribed.reduce<KmRange | null>((sum, s) => addKm(sum, s.derived.range), null);
  const optional = offered.reduce<KmRange | null>((sum, s) => addKm(sum, s.derived.range), null);
  const publish = header ?? derived;

  return {
    dayOfWeek,
    dateKey: planDayKey(weekStartDate, dayOfWeek),
    sessions,
    headerKm: header,
    derivedKm: derived,
    optionalKm: optional,
    publishKm: publish,
    publishFrom: header ? 'header' : derived ? 'derived' : 'none',
    check: sessions.length ? compareKm(header, derived) : 'rest',
    warnings: sessions.reduce((n, s) => n + s.warnings, 0),
  };
}

export interface WeekReview {
  days: DayReview[];
  /** Days with at least one session on them. */
  trainingDays: number;
  /** Sum of the day headers the coach wrote. */
  headerKm: KmRange | null;
  /** Sum of the same days built from their steps — the comparable figure. */
  derivedKm: KmRange | null;
  /** Sum of what will actually be published. */
  publishKm: KmRange | null;
  /** Header against derived, over the days that have both. */
  check: DayCheck;
  /** Days the check could form an opinion about at all. */
  checkedDays: number;
  /** Days whose km had to be multiplied out of a time — where the check bites. */
  derivedDays: number;
  warnings: number;
  sessionsWithWarnings: number;
  /** Days still carrying at least one warning, in day order. */
  daysNeedingReview: number[];
}

/**
 * The whole week, day by day, in one pass — so the rail's per-day chip, the day
 * screen's verdict and the summary's totals are one calculation read three
 * times rather than three that agree today.
 */
export function reviewWeek(
  workouts: ParsedWorkout[],
  weekStartDate: string,
  opts: EstimateOptions = {},
): WeekReview {
  const days = Array.from({ length: 7 }, (_, dayOfWeek) =>
    reviewDay(dayOfWeek, weekStartDate, workouts, opts));

  const comparable = days.filter((d) => d.headerKm && d.derivedKm);
  const headerTotal = comparable.reduce<KmRange | null>((sum, d) => addKm(sum, d.headerKm), null);
  const derivedTotal = comparable.reduce<KmRange | null>((sum, d) => addKm(sum, d.derivedKm), null);

  return {
    days,
    trainingDays: days.filter((d) => d.sessions.length).length,
    headerKm: headerTotal,
    derivedKm: derivedTotal,
    publishKm: days.reduce<KmRange | null>((sum, d) => addKm(sum, d.publishKm), null),
    check: comparable.length ? compareKm(headerTotal, derivedTotal) : 'unchecked',
    checkedDays: comparable.length,
    derivedDays: days.filter((d) => d.sessions.some((s) => s.estimated)).length,
    warnings: days.reduce((n, d) => n + d.warnings, 0),
    sessionsWithWarnings: days.reduce(
      (n, d) => n + d.sessions.filter((s) => s.warnings > 0).length, 0),
    daysNeedingReview: days.filter((d) => d.warnings > 0).map((d) => d.dayOfWeek),
  };
}

/** How many km ranges to print: "9.1–10.3", or "12" when both ends agree. */
export function formatKm(range: KmRange | null): string {
  if (!range) return '';
  return range.min === range.max ? `${range.max}` : `${range.min}–${range.max}`;
}
