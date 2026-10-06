// The trainee's academy home, as pure functions.
//
// Everything here is a decision the screen makes about numbers it was handed —
// what a week row's ring says, which three tiles today's session gets, what the
// km chart's average is, what "weeks in a row" counts — so it is all here, tested,
// and the route and the component only move data. No DB, no clock (every function
// that needs "today" is given it), no next-intl (copy is Hebrew, as in the sibling
// academy components).

import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { stepMetric, type StepUnits } from '@/lib/plans/step-display';
import { GOAL_TYPES, type Characterization } from './characterization';
import { effectiveOffsetSec, type AcademyBand } from './bands';
import { ZONE_INTENSITY, resolveIntensity } from './library';
import { paceVerdict, type PaceVerdict } from './pace-verdict';

export const HE_UNITS: StepUnits = { km: 'ק״מ', m: 'מ׳', sec: 'שנ׳', min: 'דק׳' };

// ── The API payload ─────────────────────────────────────────────────────────
// Shared by /api/academy/me (which builds it) and AcademyMyView (which draws it),
// so the two cannot disagree about a field name.

/** What a row's status mark at the end says. */
export type RowStatus =
  | { kind: 'done'; score: number | null }
  | { kind: 'partial'; pct: number }
  | { kind: 'missed' }
  | { kind: 'upcoming' };

export interface StepTile {
  kind: 'warmup' | 'main' | 'cooldown';
  label: string;
  /** sec/km, the pace printed big under the label. */
  pace: number | null;
}

export interface HomeWorkout {
  date: string;
  name: string;
  status: RowStatus;
  /** Metres. Planned is the mid-point of the plan's range. */
  plannedM: number;
  actualM: number | null;
  plannedDurationSec: number | null;
  /** The pace the sub-line prints, already judged by the pace rule (null verdict = no target). */
  pace: { actual: number; verdict: PaceVerdict | null } | null;
  /** The pace the plan asks for, for an upcoming row's sub-line. */
  plannedPace: number | null;
  /** The coach wrote feedback on this day — the 💬 chip. */
  hasFeedback: boolean;
  /** Up to three tiles; only sent for today's row. */
  steps?: StepTile[];
}

export interface HomePaces {
  bandNumber: number | null;
  easy: number;
  tempo: number;
  threshold: number;
  interval: number;
  /** Where the threshold came from — the band's own pace, or the trainee's latest test. */
  source: 'band' | 'test';
}

export interface HomeGoal {
  title: string;
  subtitle: string | null;
  daysLeft: number | null;
}

export interface HomeKmWeek {
  weekStart: string;
  km: number;
}

export interface HomeJourney {
  monthsWithUs: number | null;
  runs: number;
  km: number;
  /** 0..100, null when nothing was planned yet. */
  planPct: number | null;
  streakWeeks: number;
  longestKm: number | null;
}

export interface TraineeHome {
  isMember: boolean;
  weekStart: string;
  athlete?: { athleteId: string; name: string; avatarUrl: string | null; hasWatch: boolean };
  coach?: { id: string; name: string; avatarUrl: string | null } | null;
  unread?: number;
  goal?: HomeGoal | null;
  paces?: HomePaces | null;
  km?: { weeks: HomeKmWeek[]; plannedKm: number; avgKm: number | null };
  week?: { plannedCount: number; completedCount: number; workouts: HomeWorkout[] };
  journey?: HomeJourney;
}

// ── A week row ──────────────────────────────────────────────────────────────

/**
 * The mark at the end of a workout row.
 *
 * `partial` is decided by the adherence engine's own distance verdict ('under' =
 * below the planned range by more than the manager's tolerance), so a run the
 * compliance table calls short is short here — the percentage is of the planned
 * mid-point, which is what "6.2 מתוך 10" on the same row reads as.
 */
export function rowStatus(input: {
  date: string;
  today: string;
  completed: boolean;
  distanceStatus: string;
  distancePct: number | null;
  score: number | null | undefined;
}): RowStatus {
  if (!input.completed) return input.date < input.today ? { kind: 'missed' } : { kind: 'upcoming' };
  if (input.distanceStatus === 'under' && input.distancePct != null) {
    return { kind: 'partial', pct: Math.max(0, Math.min(99, Math.round(input.distancePct * 100))) };
  }
  return { kind: 'done', score: input.score ?? null };
}

/**
 * Which pace a row's sub-line prints, and against what.
 *
 * A continuous run is judged on its whole-run average against the band the
 * adherence engine graded (`compared*`, set only when one pace covers the run). A
 * structured session is judged on its WORK pace — the reps — because the
 * whole-run average of an interval day is mostly the jog between them. With
 * neither, the average is printed with no verdict: no target is not "on plan".
 */
export function rowPace(input: {
  averagePace: number | null;
  comparedMin: number | null;
  comparedMax: number | null;
  workPace?: { actual: number; min: number; max: number } | null;
  toleranceSec: number;
}): HomeWorkout['pace'] {
  if (input.averagePace != null && input.comparedMin != null) {
    return {
      actual: input.averagePace,
      verdict: paceVerdict(input.averagePace, input.comparedMin, input.comparedMax, input.toleranceSec),
    };
  }
  if (input.workPace) {
    return {
      actual: input.workPace.actual,
      verdict: paceVerdict(input.workPace.actual, input.workPace.min, input.workPace.max, input.toleranceSec),
    };
  }
  return input.averagePace != null && input.averagePace > 0 ? { actual: input.averagePace, verdict: null } : null;
}

/** The seven dates of a plan week, Sunday first. */
export function weekDates(weekStart: string): string[] {
  const out: string[] = [];
  const d = new Date(`${weekStart}T12:00:00Z`);
  for (let i = 0; i < 7; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// ── Today's steps ───────────────────────────────────────────────────────────

const isRest = (s: WorkoutStep) => s.type === 'rest' || s.type === 'recovery';

function stepPace(s: WorkoutStep): number | null {
  if (s.targetType !== 'pace' || !s.targetPaceMinPerKm) return null;
  const max = s.targetPaceMaxPerKm || s.targetPaceMinPerKm;
  return Math.round((s.targetPaceMinPerKm + max) / 2);
}

/** "800" for metres inside a rep label (the × already says it's a rep), "2 ק״מ" past a kilometre. */
function repLength(s: WorkoutStep): string {
  if (s.durationType === 'distance' && s.durationValue && s.durationValue < 1000) return String(s.durationValue);
  return stepMetric(s, HE_UNITS);
}

/**
 * Today's session as at most three tiles, side by side: warm-up · the main set ·
 * cool-down. Empty for a session with nothing to split (one continuous step) —
 * the row's own sub-line already says "10 ק״מ · 5:40" and a single tile would
 * repeat it.
 */
export function stepTiles(workout: Pick<ParsedWorkout, 'steps'>): StepTile[] {
  const steps = workout.steps || [];
  const warm = steps.find((s) => s.type === 'warmup' && !s.repeatCount);
  const cool = [...steps].reverse().find((s) => s.type === 'cooldown' && !s.repeatCount);
  const block = steps.find((s) => s.repeatCount && s.repeatSteps?.length);

  let main: StepTile | null = null;
  if (block) {
    const legs = block.repeatSteps || [];
    const work = legs.find((l) => !isRest(l)) || legs[0];
    const rest = legs.find(isRest);
    const restText = rest && stepMetric(rest, HE_UNITS) ? ` · מנוחה ${stepMetric(rest, HE_UNITS)}` : '';
    main = { kind: 'main', label: `${block.repeatCount} × ${repLength(work)}${restText}`, pace: stepPace(work) };
  } else {
    const work = steps.find((s) => (s.type === 'active' || s.type === 'interval') && s !== warm && s !== cool);
    if (work) main = { kind: 'main', label: stepMetric(work, HE_UNITS) || 'ריצה', pace: stepPace(work) };
  }

  const tiles: StepTile[] = [];
  if (warm) tiles.push({ kind: 'warmup', label: `חימום ${stepMetric(warm, HE_UNITS)}`.trim(), pace: stepPace(warm) });
  if (main) tiles.push(main);
  if (cool) tiles.push({ kind: 'cooldown', label: `שחרור ${stepMetric(cool, HE_UNITS)}`.trim(), pace: stepPace(cool) });
  return tiles.length >= 2 ? tiles : [];
}

/** The single pace a planned session is "at", for an upcoming row: the work pace's mid-point. */
export function plannedPaceOf(paceMin: number | null | undefined, paceMax: number | null | undefined): number | null {
  if (!paceMin) return null;
  return Math.round((paceMin + (paceMax || paceMin)) / 2);
}

// ── The km chart ────────────────────────────────────────────────────────────

/**
 * The dashed average line: over the weeks BEFORE the last one. The last bar is
 * the week in progress, and averaging a Tuesday's 14 km into a season of full
 * weeks drags the line down every Monday. Weeks before the trainee had run at all
 * (leading zeros — before they joined) are left out for the same reason.
 */
export function kmAverage(weeks: HomeKmWeek[]): number | null {
  const done = weeks.slice(0, -1);
  const first = done.findIndex((w) => w.km > 0);
  if (first < 0) return null;
  const span = done.slice(first);
  return Math.round((span.reduce((sum, w) => sum + w.km, 0) / span.length) * 10) / 10;
}

// ── The journey ─────────────────────────────────────────────────────────────

export const STREAK_THRESHOLD = 0.8;

/**
 * "% of plan done" and "weeks in a row ≥80%", over the weeks the trainee was
 * actually planned for.
 *
 * The streak counts back from the last COMPLETE week: the week in progress has not
 * had its chance yet, so it neither breaks a streak nor joins one. A week with no
 * plan at all (a holiday, a coach who skipped publishing) is stepped over rather
 * than counted as a break — the trainee did not miss it.
 */
export function journeyPlanStats(
  weeks: Array<{ weekStart: string; plannedCount: number; completedCount: number }>,
  currentWeekStart: string,
): { planPct: number | null; streakWeeks: number } {
  const past = weeks.filter((w) => w.weekStart <= currentWeekStart);
  const planned = past.reduce((n, w) => n + w.plannedCount, 0);
  const completed = past.reduce((n, w) => n + Math.min(w.completedCount, w.plannedCount), 0);

  let streakWeeks = 0;
  const finished = past.filter((w) => w.weekStart < currentWeekStart).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  for (const w of finished) {
    if (w.plannedCount === 0) continue;
    if (w.completedCount / w.plannedCount >= STREAK_THRESHOLD) streakWeeks += 1;
    else break;
  }
  return { planPct: planned ? Math.round((completed / planned) * 100) : null, streakWeeks };
}

/** Months between two YYYY-MM-DD days, to the nearest half — "3.5 חודשים איתנו". */
export function monthsBetween(from: string | null | undefined, to: string): number | null {
  if (!from) return null;
  const days = (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days) || days < 0) return null;
  return Math.round((days / 30.44) * 2) / 2;
}

// ── Goal and paces ──────────────────────────────────────────────────────────

/**
 * The goal card: the race in the trainee's words, what they are training for,
 * and the countdown. No race → the goal alone. Nothing said at all → no card.
 *
 * There is no goal TIME in the characterization (the call records the race, the
 * date and the goal type), so the subtitle is the goal type and, when the band
 * states one, the band's own goal — "sub-3", "סביב 3:30".
 */
export function goalCard(
  c: Pick<Characterization, 'goalType' | 'targetRace' | 'targetRaceDate'> | null | undefined,
  band: Pick<AcademyBand, 'goal' | 'paceProfile'> | null | undefined,
  today: string,
): HomeGoal | null {
  const goalLabel = c?.goalType ? GOAL_TYPES.find((g) => g.value === c.goalType)?.label ?? null : null;
  const bandGoal = band?.paceProfile?.marathonGoal || band?.goal || null;
  const race = c?.targetRace || null;
  if (!race && !goalLabel) return null;

  let daysLeft: number | null = null;
  if (c?.targetRaceDate) {
    const d = Math.round((Date.parse(`${c.targetRaceDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
    if (Number.isFinite(d) && d >= 0) daysLeft = d;
  }

  if (race) {
    const parts = [goalLabel, bandGoal].filter(Boolean) as string[];
    return { title: race, subtitle: parts.length ? `היעד: ${parts.join(' · ')}` : null, daysLeft };
  }
  return { title: goalLabel as string, subtitle: bandGoal ? `היעד: ${bandGoal}` : null, daysLeft };
}

/** The mid-point of a named effort, sec/km, for a threshold pace. */
function zonePace(thresholdSec: number, zone: keyof typeof ZONE_INTENSITY): number {
  const { min, max } = resolveIntensity(thresholdSec, ZONE_INTENSITY[zone]);
  return Math.round((min + max) / 2);
}

/**
 * The four paces on the trainee's home, resolved for THIS trainee.
 *
 * The band's own threshold pace first (`pace_profile.thresholdPaceSec`), moved by
 * how far this trainee's override sits from the band's offset — the band's paces
 * are written for the band's offset, so an athlete set 10 s/km slower than their
 * band runs every one of them 10 s/km slower. Failing that, the trainee's own
 * latest approved test, which IS their threshold and needs no shifting. Neither →
 * null, and the row is not drawn: a pace invented here would be a number on the
 * screen the coach never gave.
 *
 * The four efforts come off `ZONE_INTENSITY` — the same table the workout book
 * resolves a library step through, so "קל 5:40" here is the pace a book workout
 * would put on the watch.
 */
export function resolveTraineePaces(input: {
  band: Pick<AcademyBand, 'bandNumber' | 'paceProfile'> | null | undefined;
  athleteOffsetSec: number | null | undefined;
  testThresholdSec: number | null | undefined;
}): HomePaces | null {
  const band = input.band ?? null;
  const bandThreshold = band?.paceProfile?.thresholdPaceSec;
  let threshold: number | null = null;
  let source: HomePaces['source'] = 'band';
  if (typeof bandThreshold === 'number' && bandThreshold > 0) {
    const bandOffset = band?.paceProfile?.offsetSeconds;
    const own = effectiveOffsetSec(input.athleteOffsetSec, band);
    const shift = typeof bandOffset === 'number' && typeof own === 'number' ? own - bandOffset : 0;
    threshold = bandThreshold + shift;
  } else if (typeof input.testThresholdSec === 'number' && input.testThresholdSec > 0) {
    threshold = Math.round(input.testThresholdSec);
    source = 'test';
  }
  if (threshold == null || threshold <= 0) return null;
  return {
    bandNumber: band?.bandNumber ?? null,
    easy: zonePace(threshold, 'easy'),
    tempo: zonePace(threshold, 'tempo'),
    threshold: zonePace(threshold, 'threshold'),
    interval: zonePace(threshold, 'interval'),
    source,
  };
}
