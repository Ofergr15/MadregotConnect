import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

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
 * Assumed pace for a TIMED step the coach gave no pace for, seconds per km.
 *
 * These are estimates and they are the reason a plan's km show as a range at
 * all — when the coach fills in `distanceMinKm/distanceMaxKm`, `getWorkoutKm`
 * uses those and none of this runs.
 *
 * `recovery` is separate because one default for everything credited a rest
 * interval with running distance: a 90-second recovery inside an interval set
 * was being counted at 5:00–6:00/km, the same as the working reps, which
 * inflated every interval session's total. A recovery IS usually jogged, so it
 * still contributes — just not at the effort's pace.
 */
const DEFAULT_PACE_S_PER_KM = {
  running: { min: 300, max: 360 },   // 5:00–6:00 /km
  recovery: { min: 420, max: 540 },  // 7:00–9:00 /km
} as const;

export function computeStepDistance(step: WorkoutStep): { min: number; max: number } {
  if (step.repeatCount && step.repeatSteps) {
    let subMin = 0;
    let subMax = 0;
    for (const sub of step.repeatSteps) {
      const subDist = computeStepDistance(sub);
      subMin += subDist.min;
      subMax += subDist.max;
    }
    return { min: subMin * step.repeatCount, max: subMax * step.repeatCount };
  }

  if (step.durationType === 'distance' && step.durationValue) {
    return { min: step.durationValue, max: step.durationValue };
  }

  if (step.durationType === 'time' && step.durationValue) {
    const fallback = DEFAULT_PACE_S_PER_KM[step.type === 'rest' || step.type === 'recovery' ? 'recovery' : 'running'];
    const paceMin = step.targetPaceMinPerKm || fallback.min;
    // Falls back to the step's OWN min before the generic default: with
    // `|| 360`, a step carrying only a slow min (say 6:40/km) got a max of
    // 6:00/km — a max faster than its min, which inverts the range below and
    // reports distMin > distMax. A single-sided pace means one pace, not a
    // range, which is exactly what `stepGroupPace` already assumes.
    const paceMax = step.targetPaceMaxPerKm || step.targetPaceMinPerKm || fallback.max;
    const timeSec = step.durationValue;
    const distMax = (timeSec / paceMin) * 1000;
    const distMin = (timeSec / paceMax) * 1000;
    return { min: Math.round(distMin), max: Math.round(distMax) };
  }

  // Open duration with pace: estimate based on typical duration for the step type
  if (step.durationType === 'open' && step.targetPaceMinPerKm) {
    const pace = (step.targetPaceMinPerKm + (step.targetPaceMaxPerKm || step.targetPaceMinPerKm)) / 2;
    let estimatedMin = 0;
    if (step.type === 'warmup' || step.type === 'cooldown') {
      estimatedMin = 10 * 60; // 10 min warmup/cooldown
    } else if (step.type === 'active' || step.type === 'interval') {
      estimatedMin = 40 * 60; // 40 min for main active blocks
    }
    if (estimatedMin > 0) {
      const dist = (estimatedMin / pace) * 1000;
      return { min: Math.round(dist * 0.8), max: Math.round(dist * 1.2) };
    }
  }

  // Open warmup/cooldown without pace: default 2km
  if (step.durationType === 'open' && (step.type === 'warmup' || step.type === 'cooldown')) {
    return { min: 1500, max: 2500 };
  }

  return { min: 0, max: 0 };
}

export function computeWorkoutDistance(workout: ParsedWorkout): { min: number; max: number } {
  let totalMin = 0;
  let totalMax = 0;
  for (const step of workout.steps) {
    const d = computeStepDistance(step);
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

export function getWorkoutType(workout: ParsedWorkout): string {
  const name = workout.name.toLowerCase();
  const desc = ((workout as any).description || '').toLowerCase();
  const text = `${name} ${desc}`;

  if (/fartlek|פרטלק/.test(text)) return 'fartlek';
  if (/long run|ארוכה/.test(text)) return 'long_run';
  if (/interval|אינטרוול|pyramid/.test(text)) return 'intervals';
  if (/tempo|טמפו/.test(text)) return 'tempo';
  if (/easy|שחרור|recovery/.test(text)) return 'easy';
  if (/progressive|מתגברת/.test(text)) return 'progressive';

  // Only 1 step with open duration = easy run
  if (workout.steps.length === 1 && workout.steps[0].durationType === 'open') return 'easy';

  const hasIntervals = workout.steps.some(s => s.repeatCount || s.type === 'interval');
  if (hasIntervals) return 'intervals';

  return 'easy';
}

/**
 * Compact duration for a repeat's rep, used in the "Nx…" highlight badge.
 * Distance -> "200m"; time -> "Nmin" for whole minutes, else "M:SS" (so a 30s
 * rep reads "0:30", not the old buggy "0min").
 */
export function formatRepDuration(rep: WorkoutStep): string {
  if (rep.durationType === 'distance' && rep.durationValue) {
    return `${rep.durationValue}m`;
  }
  if (rep.durationType === 'time' && rep.durationValue) {
    const s = rep.durationValue;
    if (s % 60 === 0) return `${s / 60}min`;
    if (s < 60) return `0:${s.toString().padStart(2, '0')}`;
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }
  return '';
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * A workout's km range — coach-entered `distanceMinKm`/`distanceMaxKm` win
 * when present (the coach's own number beats our step-math estimate);
 * otherwise derived from computeWorkoutDistance.
 */
export function getWorkoutKm(w: ParsedWorkout): { min: number; max: number } {
  const hasCoachKm = (w as any).distanceMinKm || (w as any).distanceMaxKm;
  if (hasCoachKm) {
    return {
      min: (w as any).distanceMinKm || (w as any).distanceMaxKm || 0,
      max: (w as any).distanceMaxKm || (w as any).distanceMinKm || 0,
    };
  }
  const dist = computeWorkoutDistance(w);
  return { min: Math.round(dist.min / 1000 * 10) / 10, max: Math.round(dist.max / 1000 * 10) / 10 };
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

export interface KeySession {
  day: string;
  dayOfWeek: number;
  name: string;
  type: string;
  totalKm: number;
  highlight: string;
  steps: WorkoutStep[];
}

export interface WeekBreakdown {
  dailyDistances: DailyDistance[];
  keySessions: KeySession[];
  typeDistribution: Record<string, number>;
  weekTotalMin: number;
  weekTotalMax: number;
  trainingDays: number;
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

  const dailyDistances: DailyDistance[] = [];
  for (let d = 0; d < 7; d++) {
    const dayWorkouts = workouts.filter(w => w.dayOfWeek === d);
    if (dayWorkouts.length > 0) {
      let totalMin = 0, totalMax = 0;
      const sessions: Array<{ min: number; max: number; type: string; name: string }> = [];
      for (const workout of dayWorkouts) {
        const km = getWorkoutKm(workout);
        totalMin += km.min;
        totalMax += km.max;
        sessions.push({ min: km.min, max: km.max, type: getWorkoutType(workout), name: workout.name });
      }
      dailyDistances.push({
        day: DAY_NAMES[d],
        dayOfWeek: d,
        min: totalMin,
        max: totalMax,
        type: getWorkoutType(dayWorkouts[0]),
        sessions,
      });
    } else {
      dailyDistances.push({ day: DAY_NAMES[d], dayOfWeek: d, min: 0, max: 0, type: 'rest', sessions: [] });
    }
  }

  const weekTotalMin = dailyDistances.reduce((sum, d) => sum + d.min, 0);
  const weekTotalMax = dailyDistances.reduce((sum, d) => sum + d.max, 0);

  const keySessions: KeySession[] = [];
  const seenDays = new Set<number>();
  for (const w of workouts) {
    if (seenDays.has(w.dayOfWeek)) continue;
    const wType = getWorkoutType(w);
    if (wType === 'easy' || wType === 'rest') continue;
    seenDays.add(w.dayOfWeek);
    const km = getWorkoutKm(w);
    const avgKm = Math.round(((km.min + km.max) / 2) * 10) / 10;
    const displayName = (w as any).description || w.name;

    let highlight = '';
    if (wType === 'long_run') {
      highlight = `${km.min}–${km.max}km`;
    } else if (wType === 'fartlek') {
      const mainRepeat = w.steps.find(s => s.repeatCount && s.repeatCount > 2);
      if (mainRepeat && mainRepeat.repeatSteps?.[0]) {
        const dur = formatRepDuration(mainRepeat.repeatSteps[0]);
        if (dur) highlight = `${mainRepeat.repeatCount}x${dur}`;
      }
    } else {
      const intervalStep = w.steps.find(s => s.repeatCount && s.repeatSteps?.[0]?.durationValue);
      if (intervalStep && intervalStep.repeatSteps?.[0]) {
        const dur = formatRepDuration(intervalStep.repeatSteps[0]);
        if (dur) highlight = `${intervalStep.repeatCount}x${dur}`;
      }
    }

    keySessions.push({ day: DAY_NAMES[w.dayOfWeek], dayOfWeek: w.dayOfWeek, name: displayName, type: wType, totalKm: avgKm, highlight, steps: w.steps });
  }

  const typeDistribution: Record<string, number> = {};
  for (const w of workouts) {
    const t = getWorkoutType(w);
    const km = getWorkoutKm(w);
    // Rounded once at the end, not per workout: rounding each session first lost
    // up to 500 m a time, so a week of five sessions could report 2 km less
    // across the type split than `weekTotalMin/Max` say for the same week.
    typeDistribution[t] = (typeDistribution[t] || 0) + (km.min + km.max) / 2;
  }
  for (const t of Object.keys(typeDistribution)) {
    typeDistribution[t] = Math.round(typeDistribution[t] * 10) / 10;
  }

  const trainingDays = dailyDistances.filter(d => d.max > 0).length;

  return { dailyDistances, keySessions, typeDistribution, weekTotalMin, weekTotalMax, trainingDays };
}
