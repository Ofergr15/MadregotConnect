/**
 * The characterization call, as answers — and as the input to the first training plan.
 *
 * Step 3 of the funnel (`funnel.ts`) is a twenty-minute phone call, and the mockup is explicit
 * about what the form during that call is for: `הטופס הזה הוא גם הקלט לתוכנית הראשונה` —
 * available days, the physical limitation and the race date flow straight into the composer.
 * That single sentence is why this module exists rather than a component holding some state:
 *
 *  1. **These are inputs, not survey answers.** `availableDays` decides which days the first
 *     week has workouts on and `targetRaceDate` decides how many weeks there are to build. A
 *     field that is wrong here is a training plan that is wrong for a month, and nothing
 *     downstream will contradict it — so the checks belong somewhere they can be tested.
 *
 *  2. **The form is filled WHILE the call is happening**, which means every read has to cope
 *     with a half-filled row: the mockup's footer says `נשמר אוטומטית`, so "incomplete" is the
 *     normal state for twenty minutes and must never be an error. `characterizationIssues`
 *     therefore separates what is MISSING (say so, quietly) from what is IMPLAUSIBLE (say so
 *     loudly) — and neither one blocks a save.
 *
 *  3. **One free-text field, on purpose.** Everything except `limitations` is a choice, because
 *     a form that needs typing cannot be filled during a conversation. The mockup's own
 *     caption: `שדה חופשי אחד בלבד (מגבלות). כל השאר בחירות`.
 *
 * Pure: no clock, no database, no fetch. `today` is passed in — a module that read the
 * machine's clock could not be tested for the case that matters (a race date that has already
 * passed) and, at 02:00 in a +03:00 club, would disagree with the coach's own calendar.
 */

import { daysBetween, paceLooksImplausible } from './tests';

/** What they want out of it. The four the academy actually sells. */
export type GoalType = 'half' | 'full' | '10k' | 'fitness';

/** The coach's own read at the end of the call. */
export type Fit = 'yes' | 'maybe' | 'no';

export const GOAL_TYPES: readonly { value: GoalType; label: string }[] = [
  { value: 'half', label: 'חצי מרתון' },
  { value: 'full', label: 'מרתון' },
  { value: '10k', label: '10 ק״מ' },
  { value: 'fitness', label: 'כושר כללי' },
] as const;

/**
 * Deliberately not `yes` / `no`: `maybe` is the answer the coach actually gives most often
 * after a first call, and a two-way control would force it into one of the other two.
 */
export const FIT_OPTIONS: readonly { value: Fit; label: string }[] = [
  { value: 'yes', label: 'מתאים' },
  { value: 'maybe', label: 'בספק' },
  { value: 'no', label: 'לא מתאים' },
] as const;

/**
 * Weekday labels, indexed by `Date#getDay` — 0 is Sunday, which is the first day of the
 * training week in this app (`Sun→Sat`, the same week the planner uses). Using getDay's
 * numbering rather than a nicer 1-7 means no translation layer sits between this and the
 * calendar, which is where an off-by-one puts somebody's long run on the wrong morning.
 */
export const DAY_LABELS: readonly string[] = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const;

/**
 * What to call a field when listing what is still blank.
 *
 * Separate from the issue text on purpose: `לא נרשם נפח נוכחי` is a sentence about one field
 * and `נפח נוכחי` is its name, and a screen that needs the second one must not get there by
 * cutting the first one apart. Stripping `לא נרשם ` off a Hebrew string with a regex is both
 * fragile and exactly the kind of thing that makes a screen read as machine-written.
 */
export const FIELD_LABELS: Partial<Record<keyof Characterization, string>> = {
  goalType: 'יעד',
  targetRaceDate: 'תאריך תחרות',
  weeklyKm: 'נפח נוכחי',
  yearsRunning: 'שנות ריצה',
  availableDays: 'ימי אימון',
  limitations: 'מגבלות',
  watch: 'שעון',
  prTimeSec: 'שיא',
  fit: 'התרשמות',
};

/**
 * The fewest days a week of training can be shaped around.
 *
 * A GUESS, like the funnel's thresholds, and flagged as one: the academy's plans are three to
 * five days, so one available day is not a week — but it is also not a reason to refuse to
 * save the call. It is a warning.
 */
export const MIN_TRAINING_DAYS = 2;

/**
 * Where "that is a typo" starts, for the two numbers somebody says out loud mid-call.
 *
 * Both GUESSES. 150 km/week is a professional; 40 years of running is possible and the person
 * saying it is 55, so this is a check and not a limit. The failure being caught is the
 * finger-slip — `350` for `35`, `20` years for `2` — which otherwise sizes the first week.
 */
export const PLAUSIBLE_WEEKLY_KM = { min: 0, max: 150 };
export const PLAUSIBLE_YEARS_RUNNING = { min: 0, max: 40 };

/** One candidate's answers. Every field nullable: the row exists from the first keystroke. */
export interface Characterization {
  candidateId: string;
  goalType: GoalType | null;
  /** The race in the trainee's words ("טבריה"), and the calendar day it is run (YYYY-MM-DD). */
  targetRace: string | null;
  targetRaceDate: string | null;
  weeklyKm: number | null;
  yearsRunning: number | null;
  /** Weekday numbers, 0=Sunday … 6=Saturday. Sorted, deduplicated, nothing out of range. */
  availableDays: number[];
  limitations: string | null;
  watch: string | null;
  /**
   * A personal best as distance + time, because "10 ק״מ 48:30" is what a person says. Both or
   * neither: half a pair is not a data point, and `readCharacterization` drops it.
   */
  prDistanceM: number | null;
  prTimeSec: number | null;
  fit: Fit | null;
  recordedBy: string | null;
}

/** An empty form for a candidate nobody has characterised yet. */
export function emptyCharacterization(candidateId: string): Characterization {
  return {
    candidateId,
    goalType: null,
    targetRace: null,
    targetRaceDate: null,
    weeklyKm: null,
    yearsRunning: null,
    availableDays: [],
    limitations: null,
    watch: null,
    prDistanceM: null,
    prTimeSec: null,
    fit: null,
    recordedBy: null,
  };
}

const GOAL_KEYS = new Set<string>(GOAL_TYPES.map(g => g.value));
const FIT_KEYS = new Set<string>(FIT_OPTIONS.map(f => f.value));

/** A number, or null for anything that is not one — including the empty string and NaN. */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A non-empty trimmed string, or null. Blank and absent are the same answer here. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

/**
 * Weekday numbers, cleaned: integers 0-6 only, deduplicated, ascending.
 *
 * All four of those matter because the array arrives from a `SMALLINT[]` column and from a
 * JSON body, and every one of the wrong shapes has a consequence: a duplicate makes a
 * five-day week count as six, `7` for Sunday (the ISO numbering) lands outside `DAY_LABELS`
 * and renders as `undefined`, and an unsorted array puts Saturday's long run before Tuesday's
 * intervals in anything that reads the list in order.
 */
export function readWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const raw of value) {
    const n = num(raw);
    if (n === null || !Number.isInteger(n) || n < 0 || n > 6) continue;
    seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * A database row or a request body, as a `Characterization`.
 *
 * Unknown `goal_type` and `fit` values read as "no answer" rather than being trusted — the
 * table has no CHECK constraint on either (the choices are product and live in this module),
 * so the reader is the only thing standing between a typo in SQL and a chip rendering blank.
 */
export function readCharacterization(row: Record<string, unknown>): Characterization {
  const candidateId = String(row.candidate_id ?? row.candidateId ?? '');
  const goal = text(row.goal_type ?? row.goalType);
  const fit = text(row.fit);
  const prDistanceM = num(row.pr_distance_m ?? row.prDistanceM);
  const prTimeSec = num(row.pr_time_sec ?? row.prTimeSec);
  // Both or neither. A distance with no time (or the reverse) yields no pace, and keeping the
  // half that arrived would show "10 ק״מ" on the card as if it meant something.
  const prComplete = prDistanceM !== null && prDistanceM > 0 && prTimeSec !== null && prTimeSec > 0;
  return {
    candidateId,
    goalType: goal && GOAL_KEYS.has(goal) ? (goal as GoalType) : null,
    targetRace: text(row.target_race ?? row.targetRace),
    targetRaceDate: text(row.target_race_date ?? row.targetRaceDate),
    weeklyKm: num(row.weekly_km ?? row.weeklyKm),
    yearsRunning: num(row.years_running ?? row.yearsRunning),
    availableDays: readWeekdays(row.available_days ?? row.availableDays),
    limitations: text(row.limitations),
    watch: text(row.watch),
    prDistanceM: prComplete ? prDistanceM : null,
    prTimeSec: prComplete ? prTimeSec : null,
    fit: fit && FIT_KEYS.has(fit) ? (fit as Fit) : null,
    recordedBy: text(row.recorded_by ?? row.recordedBy),
  };
}

/** Seconds per kilometre of the personal best they quoted, or null if they quoted none. */
export function prPaceSec(c: Pick<Characterization, 'prDistanceM' | 'prTimeSec'>): number | null {
  if (c.prDistanceM === null || c.prTimeSec === null || c.prDistanceM <= 0) return null;
  return Math.round((c.prTimeSec / c.prDistanceM) * 1000);
}

/**
 * What is wrong with the form, and how wrong.
 *
 * `missing` is not an error and never blocks anything: the form is filled during a phone call
 * and is incomplete for most of it. `warning` is the interesting level — an answer that was
 * given and does not add up, which is the only kind of mistake nothing downstream will catch.
 */
export type IssueLevel = 'missing' | 'warning';

export interface CharacterizationIssue {
  field: keyof Characterization;
  level: IssueLevel;
  text: string;
}

export function characterizationIssues(c: Characterization, today: string): CharacterizationIssue[] {
  const issues: CharacterizationIssue[] = [];
  const add = (field: keyof Characterization, level: IssueLevel, t: string) => issues.push({ field, level, text: t });

  if (c.goalType === null) add('goalType', 'missing', 'לא נבחר יעד');

  if (c.availableDays.length === 0) add('availableDays', 'missing', 'לא נבחרו ימי אימון');
  else if (c.availableDays.length < MIN_TRAINING_DAYS) {
    // Worded off the only count that can reach here while `MIN_TRAINING_DAYS` is 2. Raising
    // the constant means rewording this line, which is the right amount of friction: a
    // threshold and the sentence explaining it have to agree.
    add('availableDays', 'warning', 'יום אימון אחד בלבד — קשה לבנות שבוע');
  }

  if (c.weeklyKm === null) add('weeklyKm', 'missing', 'לא נרשם נפח נוכחי');
  else if (c.weeklyKm < PLAUSIBLE_WEEKLY_KM.min || c.weeklyKm > PLAUSIBLE_WEEKLY_KM.max) {
    add('weeklyKm', 'warning', 'נפח שבועי לא סביר — אולי הקלדה');
  }

  if (c.yearsRunning !== null
    && (c.yearsRunning < PLAUSIBLE_YEARS_RUNNING.min || c.yearsRunning > PLAUSIBLE_YEARS_RUNNING.max)) {
    add('yearsRunning', 'warning', 'שנות ריצה לא סבירות — אולי הקלדה');
  }

  // A race date already behind us is the one date mistake with teeth: it makes "weeks to
  // build" negative, and a plan built backwards from a race that happened is a plan with no
  // long runs in it. Usually it is the year — `27` typed as `26` in January.
  if (c.targetRaceDate !== null && weeksToRace(c.targetRaceDate, today) === null) {
    add('targetRaceDate', 'warning', 'תאריך התחרות כבר עבר');
  }
  // A race with no date is worse than no race at all: it looks answered.
  if (c.targetRace !== null && c.targetRaceDate === null) {
    add('targetRaceDate', 'missing', 'יש תחרות מטרה בלי תאריך');
  }

  const pace = prPaceSec(c);
  if (pace !== null && paceLooksImplausible(pace)) {
    // Same check the test registry uses, and for the same reason: `48:30` entered as `4830`
    // seconds, or the distance in kilometres where metres were asked for.
    add('prTimeSec', 'warning', 'הקצב שיוצא מהשיא לא סביר');
  }

  if (c.fit === null) add('fit', 'missing', 'לא נרשמה התרשמות');

  return issues;
}

/**
 * Whether the call can be marked done.
 *
 * Deliberately NOT "no issues": a warning is an answer the coach gave and stands behind, and
 * refusing to close the step over one would leave a completed call open on the board forever.
 * Only the four fields that something downstream reads are required — and `limitations` is
 * not among them, because the common answer is "nothing", and a required field there means a
 * coach typing `אין` to get past it.
 */
export function characterizationComplete(c: Characterization): boolean {
  // The date is arbitrary and this takes no `today` argument, because not one of the `missing`
  // issues depends on it — the only date check that does ("the race has already happened") is
  // a warning. Taking a clock it does not use would invite a caller to pass the wrong one.
  return characterizationIssues(c, '1970-01-01').every(i => i.level !== 'missing');
}

/**
 * Whole weeks from `today` until the race, or null if there is no date or it has passed.
 *
 * Floored, so three days out is 0 weeks — which is true, and the honest thing to hand a plan
 * composer. A race in the past returns null rather than a negative number: every caller would
 * have to remember to check the sign, and the one that forgets builds a taper backwards.
 */
export function weeksToRace(raceDate: string | null, today: string): number | null {
  if (!raceDate) return null;
  // `daysBetween` answers 0 for a date it cannot parse, which here would read as "the race is
  // this week" — the one wrong answer that looks like a real one. The column is a DATE, so
  // anything not in that shape came from a hand-written body.
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(today)?.[1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate) || !day) return null;
  // The calendar day of `today`, so an ISO instant is an acceptable argument: every other
  // academy module takes `now` as one, and `2026-09-19T09:00:00Z` handed to `daysBetween`
  // parses as nothing and answers 0.
  const days = daysBetween(day, raceDate);
  if (!Number.isFinite(days) || days < 0) return null;
  return Math.floor(days / 7);
}

/**
 * What the plan composer gets out of the call.
 *
 * This is the handoff the mockup promises, and it is a SHAPE rather than a call into the
 * composer on purpose: the composer builds a week for a whole board of recipients
 * (`plan-slot.ts`), and the characterization is one recipient's constraints. Handing it a
 * plain object keeps the funnel from growing a dependency on the composer, and keeps the
 * composer from having to know that candidates exist.
 *
 * `ready` and `missing` travel with it because a half-filled call is the normal state: a
 * composer that receives `availableDays: []` must be able to say "the characterization is
 * missing the training days" instead of quietly building a week with no days in it.
 */
export interface PlanInputs {
  goalType: GoalType | null;
  /** The days a workout may be placed on, 0=Sunday … 6=Saturday. */
  availableDays: number[];
  daysPerWeek: number;
  /** Their current weekly volume, which is what the first week must be sized against. */
  weeklyKm: number | null;
  /** The sentence that keeps somebody off intervals for a month, verbatim. */
  limitation: string | null;
  targetRaceDate: string | null;
  weeksToRace: number | null;
  /** Their own quoted best, as seconds per kilometre — a sanity anchor before any test exists. */
  prPaceSec: number | null;
  ready: boolean;
  /** Field names of what is still missing, in the order the form asks them. */
  missing: (keyof Characterization)[];
}

export function planInputsFrom(c: Characterization, today: string): PlanInputs {
  const missing = characterizationIssues(c, today).filter(i => i.level === 'missing').map(i => i.field);
  return {
    goalType: c.goalType,
    availableDays: c.availableDays,
    daysPerWeek: c.availableDays.length,
    weeklyKm: c.weeklyKm,
    limitation: c.limitations,
    targetRaceDate: c.targetRaceDate,
    weeksToRace: weeksToRace(c.targetRaceDate, today),
    prPaceSec: prPaceSec(c),
    // The two the composer cannot invent: which days, and how much they run today. A missing
    // goal or fit verdict does not stop a week from being built.
    ready: c.availableDays.length > 0 && c.weeklyKm !== null,
    missing,
  };
}
