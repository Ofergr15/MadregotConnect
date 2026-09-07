import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { autoFixedSteps, collapsedTimeRange } from './auto-fix';
import { isRestStep, stepQualifier } from './step-display';
import {
  minutesRangeFromNotes,
  type EstimateOptions,
  isEstimate,
  workoutDistanceEstimate,
} from './step-estimate';

/**
 * The pre-flight check on one session, run before the coach publishes it.
 *
 * Publishing writes a PNG and a machine-readable text per group per session —
 * twenty-seven artifacts off one PDF — and lands them on sixty phones. Until now
 * the review screen showed the coach a picture of each one and asked them to
 * notice, by eye, that Wednesday has no distance on it, that Tuesday's ❷ pace is
 * FASTER than its ❶, or that a note says "4:50-5:30" beside a pace chip that
 * already says 4:50–5:30. Nobody checks twenty-seven images that way, so nobody
 * checked at all.
 *
 * Every finding here is a thing the coach can act on, computed off the steps.
 * Deliberately NOT a validator: nothing it says blocks publishing, because the
 * coach is the authority on their own program and "no distance" is sometimes
 * exactly what they meant to write. It's a second pair of eyes, not a gate.
 *
 * Codes and counts come out; words stay in the component (messages/*.json),
 * same rule as `step-display` — that is what keeps this unit-tested.
 */

export type AuditLevel = 'warn' | 'info';

export type AuditCode =
  /** Nothing in the session says how far it is. */
  | 'noDistance'
  /** It has a distance, but one this app multiplied out of a time and a pace. */
  | 'estimatedDistance'
  /** Run steps carrying neither a pace nor a word about how to run them. */
  | 'unpacedSteps'
  /** ❶ is meant to be the fastest group and ❸ the slowest; here it isn't. */
  | 'paceInversion'
  /** Notes that only restate the pace or the metric already on the row. */
  | 'duplicateNotes'
  /** Steps where the three groups really do run different paces. */
  | 'groupPacesDiffer'
  /** Not one step differs between the groups — all three get the same board. */
  | 'groupPacesIdentical'
  /** One step and no structure: whatever the coach wrote is all there is. */
  | 'singleStep'
  /**
   * The session opens on a rest. Nobody's Thursday starts with ten minutes of
   * standing still — a day that does is the tail of the day before it, filed
   * onto this one because the page it continued onto carried no day header.
   */
  | 'startsWithRest'
  /**
   * An interval whose three groups all run the same pace. This club writes a
   * pace per group on every interval, in three cells side by side, so one figure
   * across all three is one CELL read and handed to everybody: two of the three
   * groups get a pace that was never meant for them.
   */
  | 'sameIntervalPace'
  /**
   * A step stored as a single time whose own note still says the range it came
   * from ("70-90 דק׳" arriving as 70). The athlete gets the short end only.
   */
  | 'collapsedTimeRange'
  /**
   * A collapsed time range the import put back by itself. Reported, not silent:
   * the athlete's board now says "40-50 min" where the parse had chosen 40, and a
   * change to the plan the coach didn't make is one they are entitled to see and
   * to undo.
   */
  | 'timeRangeFixed'
  /** A maximum-effort test carrying a pace. A pace on a test is a ceiling on it. */
  | 'pacedTest'
  /**
   * A whole second session folded into another step's note ("אופציה ל30-40 דק׳
   * קל בערב"). It never reaches the athlete's calendar and its minutes are
   * counted nowhere.
   */
  | 'sessionInNotes';

export interface AuditFinding {
  code: AuditCode;
  level: AuditLevel;
  /** How many steps it is about; 1 for a finding about the whole session. */
  count: number;
  /** `step.order` of each step involved, so the screen can point at them. */
  steps: number[];
  /**
   * The same steps as objects, for a screen that marks the rows it is talking
   * about. `order` cannot do that job: it restarts at 1 inside a repeat block,
   * so a 200 m leg with `order: 1` and the 6 km run with `order: 1` are one
   * number, and matching on it stripes a row nothing was ever found in.
   */
  refs: WorkoutStep[];
}

/**
 * Warnings before observations, and a fixed order inside each.
 *
 * `startsWithRest` leads because it is the only finding about the day's IDENTITY
 * rather than its contents: if the session belongs to another day, nothing else
 * on the list is worth reading yet.
 */
const CODE_ORDER: AuditCode[] = [
  'startsWithRest',
  'noDistance',
  'paceInversion',
  'sameIntervalPace',
  'collapsedTimeRange',
  'pacedTest',
  'sessionInNotes',
  'unpacedSteps',
  // Leads the observations: it is the only one of them reporting a CHANGE rather
  // than a state, and it is the one with an action attached.
  'timeRangeFixed',
  'estimatedDistance',
  'duplicateNotes',
  'groupPacesDiffer',
  'groupPacesIdentical',
  'singleStep',
];

const WARN: AuditCode[] = [
  'noDistance', 'paceInversion', 'unpacedSteps',
  'startsWithRest', 'sameIntervalPace', 'collapsedTimeRange', 'pacedTest', 'sessionInNotes',
];

/**
 * The steps an athlete actually runs — a repeat block's legs stand in for the
 * block, since the wrapper is a container and has no pace of its own.
 */
function legSteps(steps: WorkoutStep[]): WorkoutStep[] {
  const out: WorkoutStep[] = [];
  for (const step of steps) {
    if (step.repeatCount && step.repeatSteps?.length) {
      out.push(...legSteps(step.repeatSteps));
      continue;
    }
    out.push(step);
  }
  return out;
}

/** Every step, containers included — a wrapper can still carry a note. */
function allSteps(steps: WorkoutStep[]): WorkoutStep[] {
  const out: WorkoutStep[] = [];
  for (const step of steps) {
    out.push(step);
    if (step.repeatSteps?.length) out.push(...allSteps(step.repeatSteps));
  }
  return out;
}

/** The three groups' faster bound, in group order; null where a group has none. */
function groupMins(step: WorkoutStep): [number | null, number | null, number | null] {
  return [
    step.targetPaceMinPerKm ?? null,
    step.group2Pace?.min ?? null,
    step.group3Pace?.min ?? null,
  ];
}

/**
 * True when ❶ → ❷ → ❸ get slower, as the club writes them. Groups without a
 * pace are skipped rather than treated as zero — a step where only ❷ is set is
 * not an inversion, it is a step with one pace on it.
 */
function pacesOrdered(step: WorkoutStep): boolean {
  const set = groupMins(step).filter((p): p is number => p != null);
  return set.every((pace, i) => i === 0 || set[i - 1] <= pace);
}

function pacesDiffer(step: WorkoutStep): boolean {
  const set = groupMins(step).filter((p): p is number => p != null);
  return new Set(set).size > 1;
}

/** A step the athlete runs, as opposed to a recovery or an empty container. */
function isRunStep(step: WorkoutStep): boolean {
  if (isRestStep(step)) return false;
  return !(step.repeatCount && step.repeatSteps?.length);
}

/**
 * True when one pace is doing duty for all three groups.
 *
 * An ABSENT `group2Pace` means "❷ runs ❶'s pace" everywhere else in this app
 * (see the pace cells in the review table), so absent and equal are the same
 * thing here — which is precisely why the collapse is invisible on screen.
 */
function groupsCollapsed(step: WorkoutStep): boolean {
  const [g1, g2, g3] = groupMins(step);
  if (!g1) return false;
  return (g2 == null || g2 === g1) && (g3 == null || g3 === g1);
}

/** A test, a time trial, a max effort — a step whose whole point is no ceiling. */
const TEST_RE = /טסט|מקסימום|מקס'|\btest\b|\btime ?trial\b/i;

/**
 * A note that is really a second session: the club writes offered work as
 * "אופציה ל30-40 דק׳ קל בערב / כוח", and the minutes are the tell. Both halves
 * are required — "אופציה" alone is a remark, and minutes alone are just how a
 * step is written.
 */
const OFFERED_RE = /אופצי|בערב|בבוקר|\boptional\b|\bin the evening\b/i;

function looksLikeSession(step: WorkoutStep): boolean {
  const notes = (step.notes || '').trim();
  if (!notes || !OFFERED_RE.test(notes)) return false;
  return !!minutesRangeFromNotes(notes);
}

/**
 * A time collapsed to one end of the range it was written as, and still that way.
 *
 * The fingerprint is the note surviving the collapse: `durationValue` sits
 * INSIDE a range the note still spells out. The import now repairs exactly this
 * (`lib/plans/auto-fix.ts`), so a session that has been through normalization
 * reports `timeRangeFixed` instead — this stays because a session reaching the
 * screen unfixed (an undo, a plan edited by hand) is still worth saying.
 */
function isCollapsedTime(step: WorkoutStep): boolean {
  return collapsedTimeRange(step) !== null;
}

/**
 * Everything worth saying about one session, most serious first.
 *
 * `opts` is the week's own pace band (`planEstimateOptions`) — the same one the
 * distances on screen are figured with, so a session the screen shows as an
 * estimate is the session this reports as one.
 */
export function auditWorkout(workout: ParsedWorkout, opts?: EstimateOptions): AuditFinding[] {
  const found: AuditFinding[] = [];
  // Takes the STEPS, not their orders: the screen needs identity to mark a row
  // (see AuditFinding.refs), and `steps` stays the plain order list callers read.
  const add = (code: AuditCode, refs: WorkoutStep[]) => {
    found.push({
      code,
      level: WARN.includes(code) ? 'warn' : 'info',
      count: refs.length || 1,
      steps: refs.map((s) => s.order),
      refs,
    });
  };

  const steps = workout.steps || [];
  const legs = legSteps(steps);
  const every = allSteps(steps);

  // First, the only finding about whether this session belongs to this day at all.
  // A one-step session is exempt: "מנוחה" on its own is a rest day, not a tail.
  if (steps.length > 1 && isRestStep(steps[0])) add('startsWithRest', [steps[0]]);

  // Strict on purpose: `assumeOpenBlocks` would credit an information-free
  // warmup with a nominal 2 km, and a session that only LOOKS like it has a
  // distance is the thing this finding exists to catch.
  const distance = workoutDistanceEstimate(workout, opts);
  if (distance.from === 'none' || distance.range.max === 0) add('noDistance', []);
  else if (isEstimate(distance.from)) add('estimatedDistance', []);

  const inverted = legs.filter((s) => !pacesOrdered(s));
  if (inverted.length) add('paceInversion', inverted);

  const unpaced = legs.filter((s) => isRunStep(s) && !s.targetPaceMinPerKm && !stepQualifier(s));
  if (unpaced.length) add('unpacedSteps', unpaced);

  // Every interval in this program is written as three cells; one figure across
  // all three is one cell read and copied, not a coach who stopped
  // differentiating mid-session.
  const collapsed = legs.filter((s) => s.type === 'interval' && groupsCollapsed(s));
  if (collapsed.length) add('sameIntervalPace', collapsed);

  const clipped = every.filter(isCollapsedTime);
  if (clipped.length) add('collapsedTimeRange', clipped);

  const restored = autoFixedSteps(workout);
  if (restored.length) add('timeRangeFixed', restored);

  // A test is testish either because the whole part is one (`partKind`) or
  // because its own note says so. Warmups and cooldowns inside a test session
  // are meant to carry a pace, so only the working steps count.
  const testSession = workout.partKind === 'test' || TEST_RE.test(workout.name || '');
  const cappedTests = legs.filter((s) => {
    if (!s.targetPaceMinPerKm) return false;
    if (TEST_RE.test(s.notes || '')) return true;
    return testSession && (s.type === 'interval' || s.type === 'active');
  });
  if (cappedTests.length) add('pacedTest', cappedTests);

  // An evening session that IS its own part has already been split out properly;
  // this is about the ones still living inside somebody else's note.
  const buried = workout.optional || workout.partKind === 'evening' || workout.partKind === 'morning'
    ? []
    : every.filter(looksLikeSession);
  if (buried.length) add('sessionInNotes', buried);

  // `stepQualifier` is what the row already prints; a note it empties out is a
  // note whose entire content is the pace and the minutes beside it.
  const echoes = every.filter((s) => (s.notes || '').trim() && !stepQualifier(s));
  if (echoes.length) add('duplicateNotes', echoes);

  const differing = legs.filter(pacesDiffer);
  if (differing.length) add('groupPacesDiffer', differing);
  // `sameIntervalPace` has already said this, about the exact steps it is true
  // of — repeating it as a session-wide observation is noise on the same screen.
  else if (legs.some((s) => s.targetPaceMinPerKm) && !collapsed.length) {
    add('groupPacesIdentical', []);
  }

  if (steps.length === 1 && !steps[0].repeatCount) add('singleStep', []);

  return found.sort((a, b) => CODE_ORDER.indexOf(a.code) - CODE_ORDER.indexOf(b.code));
}

/** How many of the findings are warnings — the number the review chip shows. */
export function countWarnings(findings: AuditFinding[]): number {
  return findings.filter((f) => f.level === 'warn').length;
}

export interface WeekAudit {
  /** Findings per session, keyed by the same key `WeekSession.key` uses. */
  byKey: Record<string, AuditFinding[]>;
  /** Sessions with at least one warning — what the hero counts. */
  sessionsWithWarnings: number;
  /** Steps across the week whose groups really do run different paces. */
  differingPaceSteps: number;
}

/**
 * The whole week audited in one pass, so the hero's counts and each session's
 * chip are the same numbers rather than two functions that agree today.
 */
export function auditWeek(workouts: ParsedWorkout[], opts?: EstimateOptions): WeekAudit {
  const byKey: Record<string, AuditFinding[]> = {};
  let sessionsWithWarnings = 0;
  let differingPaceSteps = 0;

  workouts.forEach((w, i) => {
    const findings = auditWorkout(w, opts);
    byKey[w.workoutKey || `day-${w.dayOfWeek}-part-${w.partIndex ?? i + 1}`] = findings;
    if (countWarnings(findings)) sessionsWithWarnings++;
    differingPaceSteps += findings.find((f) => f.code === 'groupPacesDiffer')?.count || 0;
  });

  return { byKey, sessionsWithWarnings, differingPaceSteps };
}
