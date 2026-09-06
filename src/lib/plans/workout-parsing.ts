import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { workoutDurationSec } from '@/lib/workout-duration';
import {
  type EstimateOptions,
  type Provenance,
  planEstimateOptions,
  stepDistanceRange,
  workoutDistanceEstimate,
} from './step-estimate';
import { classifyWorkout } from './session-summary';
import { sessionKind } from './session-label';

/**
 * Shared parsing/derivation logic for `weekly_plans.parsed_workouts` (the
 * AI-parsed structured plan JSON). Extracted from `src/app/api/dashboard/weekly/route.ts`
 * (that route now imports from here — behavior-preserving refactor) so any
 * other surface that needs to render a parsed plan (e.g. the Program page)
 * reuses the exact same math instead of re-deriving it and risking drift.
 */

const TIMEZONE = 'Asia/Jerusalem';
// After this hour on Saturday, athletes preview the UPCOMING week's plan.
const ROLLOVER_HOUR = 20;

/**
 * Israel wall-clock parts for a given instant (handles IDT/IST DST via Intl).
 */
export function israelParts(date: Date): { year: number; month: number; day: number; weekday: number; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday as string] ?? 0,
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
  };
}

/**
 * The plan week (Sunday YYYY-MM-DD) that athletes should currently SEE.
 * Normally the current Israel week, but after Saturday 20:00 it advances to the
 * upcoming week so athletes can preview next week's training on Sat evening.
 */
export function getDisplayWeekStart(now: Date): string {
  const p = israelParts(now);
  const israelMidday = new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0));
  let daysSinceSunday = p.weekday;
  if (p.weekday === 6 && p.hour >= ROLLOVER_HOUR) {
    daysSinceSunday = -1; // Sunday is 1 day ahead
  }
  const sunday = new Date(israelMidday);
  sunday.setUTCDate(israelMidday.getUTCDate() - daysSinceSunday);
  return sunday.toISOString().split('T')[0];
}

/**
 * The calendar date (YYYY-MM-DD) a plan day falls on: `weekStart` + `dayOfWeek`.
 *
 * Every surface that renders a plan needs this, and getting it by hand is how
 * "today's workout" ended up showing a session from a different week. A
 * `dailyDistances` entry carries only a `dayOfWeek`, which is meaningless
 * without the week it belongs to — and the week the API returns is NOT always
 * the week the browser is standing in (`getDisplayWeekStart` rolls forward on
 * Saturday evening). Compare dates, never weekdays.
 *
 * Pure UTC arithmetic on the date string, so it answers the same on a UTC
 * server and in any viewer's timezone.
 */
export function planDayKey(weekStart: string, dayOfWeek: number): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayOfWeek);
  return d.toISOString().split('T')[0];
}

/**
 * A plan week rendered as its "DD.MM – DD.MM" Sunday→Saturday date range.
 *
 * Lives here next to `getDisplayWeekStart` because the range is only ever the
 * label for a week start this module produced. It used to be a private helper
 * in the Program page, which left the Profile page's "This week's program" row
 * with no way to say which week it meant — that row shipped a hardcoded
 * `Week 5` list instead, and was still claiming week 5 of June months later.
 *
 * Pure UTC arithmetic on the date string, same as `planDayKey`, so it answers
 * the same on a UTC server and in any viewer's timezone.
 */
export function formatPlanWeekRange(sundayISO: string): string {
  const sunday = new Date(`${sundayISO}T00:00:00Z`);
  const saturday = new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate() + 6);
  const fmt = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${fmt(sunday)} – ${fmt(saturday)}`;
}

export function extractWorkouts(parsedWorkouts: any): ParsedWorkout[] {
  if (!parsedWorkouts) return [];

  // Format: { workouts: [...] }
  if (Array.isArray(parsedWorkouts.workouts)) {
    return parsedWorkouts.workouts;
  }

  // Format: { group1: { workouts: [...] }, group2: {...}, ... }
  // Use group1 as the default display group
  for (const key of ['group1', 'group2', 'group3']) {
    const group = parsedWorkouts[key];
    if (group?.workouts && Array.isArray(group.workouts)) {
      return group.workouts;
    }
  }

  // Try any key that has workouts array
  for (const val of Object.values(parsedWorkouts)) {
    if (val && typeof val === 'object' && 'workouts' in (val as any)) {
      const w = (val as any).workouts;
      if (Array.isArray(w)) return w;
    }
  }

  return [];
}

/**
 * Annotate each step of the group-1 workouts with ALL THREE groups' paces, so
 * the athlete view can render "3:30 (3:40) ((3:50))" per block. The stored
 * group1/group2/group3 arrays are parallel (same days, same step tree — only
 * the pace differs), so we walk them together by day + step position. Falls
 * back gracefully when a plan is flat (single group) or a group is missing.
 */
type GroupPace = { min: number; max: number } | null;

function stepGroupPace(step: WorkoutStep | undefined): GroupPace {
  if (!step || !step.targetPaceMinPerKm) return null;
  return { min: step.targetPaceMinPerKm, max: step.targetPaceMaxPerKm || step.targetPaceMinPerKm };
}

function annotateSteps(s1: WorkoutStep[], s2: WorkoutStep[], s3: WorkoutStep[]): WorkoutStep[] {
  return s1.map((step, i) => {
    const s2i = s2[i];
    const s3i = s3[i];
    const annotated: any = {
      ...step,
      groupPaces: [stepGroupPace(step), stepGroupPace(s2i), stepGroupPace(s3i)],
    };
    if (step.repeatSteps) {
      annotated.repeatSteps = annotateSteps(
        step.repeatSteps,
        s2i?.repeatSteps || step.repeatSteps,
        s3i?.repeatSteps || step.repeatSteps,
      );
    }
    return annotated;
  });
}

export function enrichWithGroupPaces(parsedWorkouts: any): ParsedWorkout[] {
  const g1 = extractWorkouts(parsedWorkouts);
  const g2 = parsedWorkouts?.group2?.workouts as ParsedWorkout[] | undefined;
  const g3 = parsedWorkouts?.group3?.workouts as ParsedWorkout[] | undefined;
  // Flat plan (single group) or no per-group split → nothing extra to attach;
  // groupPaces falls back to group1's own pace for all three.
  return g1.map(w => {
    const w2 = g2?.find(x => x.dayOfWeek === w.dayOfWeek) || w;
    const w3 = g3?.find(x => x.dayOfWeek === w.dayOfWeek) || w;
    return { ...w, steps: annotateSteps(w.steps, w2.steps, w3.steps) };
  });
}

/**
 * Distance for one step, in metres.
 *
 * The arithmetic — and the assumed pace bands it falls back on — now lives in
 * `lib/plans/step-estimate.ts`, which four near-identical copies of it had
 * already drifted apart from. `assumeOpenBlocks` keeps this door's answer for an
 * open-ended warmup carrying no information (a nominal 2 km) rather than the
 * canonical `workout-distance.ts` answer (nothing); see the option's own note.
 */
export function computeStepDistance(
  step: WorkoutStep,
  opts: EstimateOptions = {},
): { min: number; max: number } {
  return stepDistanceRange(step, { assumeOpenBlocks: true, ...opts }).range;
}

export function computeWorkoutDistance(
  workout: ParsedWorkout,
  opts: EstimateOptions = {},
): { min: number; max: number } {
  let totalMin = 0;
  let totalMax = 0;
  for (const step of workout.steps) {
    const d = computeStepDistance(step, opts);
    totalMin += d.min;
    totalMax += d.max;
  }
  return { min: totalMin, max: totalMax };
}

// Single source of truth for a workout type's display color/label — used by
// both the dashboard's weekly bar chart and the Program page's day cards, so
// "long_run" is always purple everywhere rather than two palettes drifting.
export const WORKOUT_TYPE_COLORS: Record<string, string> = {
  intervals: '#ef4444', long_run: '#a855f7', tempo: '#f97316',
  // `rest` is the absence of a workout, so it's the page grey the light system
  // uses for an empty tile — not an ink value, which would read as a hard day.
  fartlek: '#ec4899', progressive: '#14b8a6', easy: '#159AFF', rest: '#BBBBBB',
};

// The same seven hues, dark enough to be READ. The map above is a fill palette —
// bars, dots, step blocks — where saturation is the whole point and contrast
// against the page is irrelevant. Used as a text colour it fails AA on every
// entry (2.49:1 for `progressive`, 1.92:1 for `rest`), which is what the profile
// card's workout-type cell was doing at 3.76:1.
//
// Two maps rather than one darkened map, because darkening the fills would mute
// the weekly bar chart and the Program step blocks for no reason — and because
// the fills are shared with the screens still on the dark palette, where these
// text values would be the ones that disappear. Keep the keys in step.
export const WORKOUT_TYPE_TEXT_COLORS: Record<string, string> = {
  intervals: '#AD3838', long_run: '#6B21A8', tempo: '#8A2B08',
  fartlek: '#9D174D', progressive: '#115E59', easy: '#0B5285', rest: '#5F5F5F',
};

export const WORKOUT_TYPE_LABELS: Record<string, string> = {
  intervals: 'Intervals', long_run: 'Long Run', tempo: 'Tempo',
  fartlek: 'Fartlek', progressive: 'Progressive', easy: 'Easy', rest: 'Rest',
};

// `formatRepDuration` lived here — a rep's duration for the old "Nx…" highlight
// badge, in its own private format ("200m", "8min", "0:15"). The badge is gone:
// a session's headline is now built by `sessionHeadline` off `stepMetric`, which
// is the same wording the step rows themselves use and is translated.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * A workout's km range, and how much it is worth: coach-entered
 * `distanceMinKm`/`distanceMaxKm` win when present (the coach's own number beats
 * any step-math estimate), otherwise the steps are summed and a time stated in
 * prose is multiplied by its pace.
 *
 * `from` is what lets a screen mark a calculated figure as one. Without it, the
 * 5–8 km this now reports for "אופציה ל30-40 דק׳ קל בערב" looks exactly like the
 * 11–13 km the coach typed, and the athlete has no way to tell which of the two
 * came off the plan.
 */
export function getWorkoutKm(
  w: ParsedWorkout,
  opts?: EstimateOptions,
): { min: number; max: number; from: Provenance } {
  const estimate = workoutDistanceEstimate(w, { assumeOpenBlocks: true, ...opts });
  // The coach's own figure passes through UNROUNDED — "23.65 ק"מ" is what they
  // wrote, and rounding each session to 0.1 before the day and the week sum them
  // loses about a kilometre off a nine-session week. Only the step-derived metres
  // are rounded, because a sum of estimates does not deserve three decimals.
  if (estimate.from === 'coach') {
    return { min: estimate.range.min / 1000, max: estimate.range.max / 1000, from: estimate.from };
  }
  return {
    min: Math.round((estimate.range.min / 1000) * 10) / 10,
    max: Math.round((estimate.range.max / 1000) * 10) / 10,
    from: estimate.from,
  };
}

/**
 * Drops duplicate workouts within a day while KEEPING a day's separate parts.
 *
 * The old rule here was "keep only the first workout per `dayOfWeek`",
 * justified as collapsing the three group variants. On the paths that call it
 * that justification is false: `extractWorkouts` returns exactly ONE group's
 * array (group1's, or the flat `workouts` array), and `enrichWithGroupPaces`
 * folds groups 2 and 3 in as `groupPaces` on the steps rather than appending
 * workouts. So the only thing a blind first-per-day filter could ever remove
 * was a genuine second session — which `ParsedWorkout.partIndex/partCount`
 * exists to express, and which `buildWeekBreakdown`'s own per-day loop is
 * written to sum. Measured against all 11 plans in the database: every one has
 * exactly one workout per day in both shapes, so this changes no current
 * number; it stops a double day being silently halved.
 *
 * Keyed on day + name so a true duplicate (same day, same workout, e.g. a
 * re-parse that appended instead of replacing) still collapses.
 */
export function dedupeWorkoutsByDay(workouts: ParsedWorkout[]): ParsedWorkout[] {
  const seen = new Set<string>();
  return workouts.filter((w) => {
    const key = `${w.dayOfWeek}|${w.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface DailyDistance {
  day: string;
  dayOfWeek: number;
  min: number;
  max: number;
  type: string;
  sessions: Array<{ min: number; max: number; type: string; name: string }>;
}

/**
 * One SESSION of the week — every one of them, in the order they are run.
 *
 * This replaces `keySessions`, which was one session per day, skipped anything
 * typed `easy`, and carried a `highlight` taken from the first repeat block in
 * the steps. On the real week of 2026-09-06 that meant four of the nine
 * sessions did not exist as far as the Plan tab was concerned: Tuesday's
 * evening 20 × 500 m @3:25 was inside a day whose row was already spoken for,
 * so it could not be opened at all, and Friday's 32 km ITALIAN MEDIO was
 * dropped for being "easy". A screen that hides half the week is worse than no
 * screen.
 *
 * The headline and sub-line are NOT here: they are words, and they are built
 * from `steps` by `sessionHeadline`/`sessionFrame` at the point where the
 * athlete's own language is known.
 */
export interface WeekSession {
  /** The plan's own stable id when it has one — see ParsedWorkout.workoutKey. */
  key: string;
  dayOfWeek: number;
  /** The coach's title for the session. */
  name: string;
  type: string;
  /** How to label it when the day holds more than one; null when it doesn't. */
  kind: 'morning' | 'evening' | 'part' | null;
  partIndex: number;
  partCount: number;
  /** Offered, not prescribed ("ערב - אופציה") — still shown, never summed away. */
  optional: boolean;
  kmMin: number;
  kmMax: number;
  /** Where the km came from; `isEstimate(kmFrom)` is the "~" test. */
  kmFrom: Provenance;
  durationSec: number;
  steps: WorkoutStep[];
}

export interface WeekBreakdown {
  dailyDistances: DailyDistance[];
  sessions: WeekSession[];
  typeDistribution: Record<string, number>;
  weekTotalMin: number;
  weekTotalMax: number;
  trainingDays: number;
}

/** One decimal. Two 1-decimal sessions summed in binary give 39.400000000000006. */
function round1(km: number): number {
  return Math.round(km * 10) / 10;
}

/** Hardest first — what a day of two sessions is called, and coloured. */
const TYPE_HARDNESS = ['intervals', 'tempo', 'fartlek', 'progressive', 'long_run', 'easy', 'rest'];

function hardestType(sessions: WeekSession[]): string {
  // An unranked type sorts LAST, not first: `indexOf` answers -1 for one, and
  // taking that at face value would let an unknown label outrank intervals.
  const rank = (type: string) => {
    const i = TYPE_HARDNESS.indexOf(type);
    return i === -1 ? TYPE_HARDNESS.length : i;
  };
  const ranked = [...sessions].sort((a, b) => rank(a.type) - rank(b.type));
  return ranked[0]?.type || 'rest';
}

/**
 * Every session of the week, ordered day then part.
 *
 * The `kind` labels are repaired here rather than trusted verbatim: Monday is
 * stored as part 1 `single` + part 2 `evening`, so `sessionKind` calls the first
 * one "part 1/2" — a filing label, when the day itself already says the second
 * session is the evening one and this is therefore the morning one.
 */
export function buildWeekSessions(workouts: ParsedWorkout[]): WeekSession[] {
  const ordered = [...workouts].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || (a.partIndex ?? 1) - (b.partIndex ?? 1),
  );
  // Derived from the week, once, and handed to every session in it: an unpaced
  // easy run is then priced at the pace band THIS coach writes (4:50–5:30 here)
  // rather than the module's global 5:00–6:00, which is slower than anything on
  // the plan and shortens every estimate by about a kilometre.
  const opts = planEstimateOptions(ordered);

  return ordered.map((w, i) => {
    const km = getWorkoutKm(w, opts);
    const dayParts = ordered.filter(x => x.dayOfWeek === w.dayOfWeek);
    let kind = sessionKind(w);
    if (kind === 'part') {
      const evening = dayParts.find(x => x.partKind === 'evening');
      const morning = dayParts.find(x => x.partKind === 'morning');
      if (evening && (w.partIndex ?? 1) < (evening.partIndex ?? 1)) kind = 'morning';
      else if (morning && (w.partIndex ?? 1) > (morning.partIndex ?? 1)) kind = 'evening';
    }

    return {
      key: w.workoutKey || `day-${w.dayOfWeek}-part-${w.partIndex ?? i + 1}`,
      dayOfWeek: w.dayOfWeek,
      name: w.description || w.name,
      type: classifyWorkout(w),
      kind,
      partIndex: w.partIndex ?? 1,
      partCount: w.partCount ?? dayParts.length,
      optional: !!w.optional,
      kmMin: km.min,
      kmMax: km.max,
      kmFrom: km.from,
      durationSec: workoutDurationSec(w, opts),
      steps: w.steps,
    };
  });
}

/**
 * One plan's `parsed_workouts` → the full per-day breakdown used by both the
 * dashboard's current-week chart (`/api/dashboard/weekly`) and the Program
 * page's arbitrary-week view (`/api/plans/week`) — kept as ONE function so
 * those two surfaces can never compute a day's distance/type/highlight
 * differently.
 */
export function buildWeekBreakdown(parsedWorkouts: any): WeekBreakdown {
  const workouts = dedupeWorkoutsByDay(enrichWithGroupPaces(parsedWorkouts));

  const sessions = buildWeekSessions(workouts);

  let rawWeekMin = 0;
  let rawWeekMax = 0;
  const dailyDistances: DailyDistance[] = [];
  for (let d = 0; d < 7; d++) {
    const daySessions = sessions.filter(s => s.dayOfWeek === d);
    if (daySessions.length === 0) {
      dailyDistances.push({ day: DAY_NAMES[d], dayOfWeek: d, min: 0, max: 0, type: 'rest', sessions: [] });
      continue;
    }
    const totalMin = daySessions.reduce((sum, s) => sum + s.kmMin, 0);
    const totalMax = daySessions.reduce((sum, s) => sum + s.kmMax, 0);
    rawWeekMin += totalMin;
    rawWeekMax += totalMax;
    dailyDistances.push({
      day: DAY_NAMES[d],
      dayOfWeek: d,
      // Rounded, because this is a SUM of the day's sessions and the athlete
      // reads it: Tuesday's 17.6 + 21.8 was rendering as 39.400000000000006.
      min: round1(totalMin),
      max: round1(totalMax),
      // The day's HARDEST session, not its first. Monday leads with an easy
      // hour and Tuesday leads with intervals, but a day whose colour comes
      // from whichever part happened to be recorded first is a coin toss.
      type: hardestType(daySessions),
      sessions: daySessions.map(s => ({ min: s.kmMin, max: s.kmMax, type: s.type, name: s.name })),
    });
  }

  // Rounded from the raw floats rather than from the rounded days, so the week
  // total and the type split below (which is also raw-then-rounded) agree.
  const weekTotalMin = round1(rawWeekMin);
  const weekTotalMax = round1(rawWeekMax);

  const typeDistribution: Record<string, number> = {};
  for (const w of workouts) {
    const t = classifyWorkout(w);
    const km = getWorkoutKm(w);
    // Rounded once at the end, not per workout: rounding each session first lost
    // up to 500 m a time, so a week of five sessions could report 2 km less
    // across the type split than `weekTotalMin/Max` say for the same week.
    typeDistribution[t] = (typeDistribution[t] || 0) + (km.min + km.max) / 2;
  }
  for (const t of Object.keys(typeDistribution)) {
    typeDistribution[t] = Math.round(typeDistribution[t] * 10) / 10;
  }

  // Days, not sessions — `sessions.length` is the session count, and the week of
  // 2026-09-06 has nine sessions across seven days.
  const trainingDays = dailyDistances.filter(d => d.max > 0).length;

  return { dailyDistances, sessions, typeDistribution, weekTotalMin, weekTotalMax, trainingDays };
}
