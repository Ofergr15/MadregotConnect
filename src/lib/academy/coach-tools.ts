/**
 * The academy coach tools (mockup academy-coach-tools.html): a pace suggestion when a
 * trainee runs faster or slower than the plan for a while, what to do with a week of missed
 * workouts, and copying a week forward or to other trainees.
 *
 * Pure, Supabase-free and clock-free: the routes read the rows and hand them in, this
 * decides. Three rules run through all of it, straight from the mockup's "הכללים":
 *
 *   1. The coach decides. Everything here is a SUGGESTION or a PREVIEW; nothing in this file
 *      writes, and the routes only write on the coach's tap.
 *   2. Paces are relative to the test. A copied week is restated against the source
 *      trainee's threshold and resolved again from the target's, so each trainee gets their
 *      own paces. A trainee with no test gets the workouts without paces.
 *   3. A new test resets everything. Every suggestion, snooze and pace update is keyed to
 *      the test it was made against (`basisTestDate`), so a newer test simply starts over.
 *
 * ── What a "kind" of pace is ───────────────────────────────────────────────────────────
 *
 * The mockup's table has three rows, חזרות / טמפו / קל, and only some of them move. One
 * threshold cannot carry that: moving the threshold by the reps' 7 s/km moves an easy run
 * by ~10 s/km (it is a percentage of speed, library.ts). So a pace update is a per-kind
 * offset, and a step's kind is the tone of its pace against the trainee's threshold, the
 * book's own split (book-steps.ts `toneOfPct`): faster than threshold = reps, around it =
 * tempo, slower = easy. A long run is easy.
 */

import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { formatPace } from '@/lib/garmin/pace';
import { MAX_PACE_SEC_PER_KM, MIN_PACE_SEC_PER_KM, shiftPacesInNotes } from './repace';
import {
  ESTIMATE_THRESHOLD_SEC, absoluteToLibrary, bookTotals, effortFromZone, fromLibrarySteps, mainStepIndex,
  structureName, toLibrarySteps, toneOf, toneOfPct, type BookStep, type Length,
} from './book-steps';
import { resolveLibraryWorkout, type LibraryStep } from './library';
import type { ComplianceColor } from './compliance';
import { PACE_KINDS, kindShift, paceKindOf, type PaceAdjust, type PaceKind } from './pace-kinds';

// ── Kinds ──────────────────────────────────────────────────────────────────────────────

// The kinds, and which kind a pace is, live in ./pace-kinds so the book's screens use the
// very same rule.
export { PACE_KINDS, paceKindOf, paceKindOfPct, kindShift } from './pace-kinds';
export type { PaceAdjust, PaceKind } from './pace-kinds';

const centre = (min?: number, max?: number): number | null => {
  const a = typeof min === 'number' && min > 0 ? min : null;
  const b = typeof max === 'number' && max > 0 ? max : a;
  if (a === null || b === null) return null;
  return (a + b) / 2;
};

/** A step that carries a pace target on the watch. */
const pacedStep = (s: WorkoutStep) => s.targetType === 'pace' && centre(s.targetPaceMinPerKm, s.targetPaceMaxPerKm) !== null;

/** Drop zero entries, so `{}` means "no update". */
export function cleanAdjust(adjust: PaceAdjust | null | undefined): PaceAdjust {
  const out: PaceAdjust = {};
  for (const k of PACE_KINDS) {
    const v = adjust?.[k];
    if (typeof v === 'number' && Number.isFinite(v) && Math.round(v) !== 0) out[k] = Math.round(v);
  }
  return out;
}

export function addAdjust(a: PaceAdjust, b: PaceAdjust): PaceAdjust {
  const out: PaceAdjust = {};
  for (const k of PACE_KINDS) out[k] = (a[k] ?? 0) + (b[k] ?? 0);
  return cleanAdjust(out);
}

// ── 1 · The pace suggestion ────────────────────────────────────────────────────────────

/** At least this many sessions of one kind before anything is said. The mockup's rule. */
export const PACE_MIN_SESSIONS = 4;
/** The sessions looked at: the most recent ones of that kind. The mockup's "5 האחרונים". */
export const PACE_WINDOW = 5;
/** Beyond this, a session counts as faster or slower than plan. Same floor as tests.ts. */
export const PACE_MEANINGFUL_SEC = 5;
/** The average HR of the newer half this much above the older half = "the HR went up". */
export const HR_RISE_BPM = 3;
/** The most one suggestion moves a pace. A bigger gap is a conversation, or a new test. */
export const PACE_MAX_CHANGE_SEC = 15;
/** "לא עכשיו" stays quiet this long. */
export const PACE_SNOOZE_DAYS = 14;

export interface PaceSession {
  date: string;
  kind: PaceKind;
  /** The centre of the work band as planned, sec/km. */
  plannedSec: number;
  /** The work as run, sec/km. */
  actualSec: number;
  /** Average HR of the run; null when the watch did not record one. */
  avgHr: number | null;
}

export type HrVerdict = 'flat' | 'rose' | 'missing';

export interface KindEvidence {
  kind: PaceKind;
  direction: 'faster' | 'slower';
  /** The window, oldest first. */
  sessions: PaceSession[];
  /** How many of them were beyond the 5 s/km floor in `direction`. */
  moved: number;
  /** The median of actual − planned over the window, sec/km (negative = faster). */
  deltaSec: number;
  /** What "לעדכן" would change the plan by. Same sign as `deltaSec`, capped. */
  proposedSec: number;
  /** "חצי מזה": half, toward zero. */
  halfSec: number;
  hr: HrVerdict;
  /** What the plan says today: the latest session's planned pace. */
  currentSec: number;
}

export type KindCheck =
  | { kind: PaceKind; qualifies: true; evidence: KindEvidence }
  | { kind: PaceKind; qualifies: false; reason: 'few' | 'mixed' | 'hr-rose'; hr?: HrVerdict };

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Did the HR go up across the window? The older half against the newer half (the middle
 * session of an odd window sits out). Faster at the same HR is fitness; faster with a
 * rising HR is the trainee pushing, which is no reason to make the plan harder. Missing HR
 * is said as missing and counts for nothing either way: fewer than two readings in either
 * half is "missing".
 */
export function hrVerdict(sessions: PaceSession[]): HrVerdict {
  const half = Math.floor(sessions.length / 2);
  if (half < 1) return 'missing';
  const older = sessions.slice(0, half).map(s => s.avgHr).filter((h): h is number => typeof h === 'number' && h > 0);
  const newer = sessions.slice(sessions.length - half).map(s => s.avgHr).filter((h): h is number => typeof h === 'number' && h > 0);
  if (older.length < Math.min(2, half) || newer.length < Math.min(2, half) || older.length === 0 || newer.length === 0) return 'missing';
  return mean(newer) - mean(older) >= HR_RISE_BPM ? 'rose' : 'flat';
}

/** One kind's verdict over a trainee's sessions (any order, any kinds). */
export function checkKind(all: PaceSession[], kind: PaceKind): KindCheck {
  const sessions = all
    .filter(s => s.kind === kind && s.plannedSec > 0 && s.actualSec > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-PACE_WINDOW);
  if (sessions.length < PACE_MIN_SESSIONS) return { kind, qualifies: false, reason: 'few' };
  const deltas = sessions.map(s => s.actualSec - s.plannedSec);
  const faster = deltas.filter(d => d < -PACE_MEANINGFUL_SEC).length;
  const slower = deltas.filter(d => d > PACE_MEANINGFUL_SEC).length;
  const direction = faster * 2 > sessions.length ? 'faster' : slower * 2 > sessions.length ? 'slower' : null;
  if (!direction) return { kind, qualifies: false, reason: 'mixed' };
  const hr = hrVerdict(sessions);
  if (hr === 'rose') return { kind, qualifies: false, reason: 'hr-rose', hr };
  const deltaSec = Math.round(median(deltas));
  // The median can sit inside the floor when the moved ones are a bare majority; the
  // change is then at least the floor, in the moved direction.
  const raw = direction === 'faster' ? Math.min(deltaSec, -PACE_MEANINGFUL_SEC) : Math.max(deltaSec, PACE_MEANINGFUL_SEC);
  const proposedSec = Math.max(-PACE_MAX_CHANGE_SEC, Math.min(PACE_MAX_CHANGE_SEC, raw));
  return {
    kind,
    qualifies: true,
    evidence: {
      kind,
      direction,
      sessions,
      moved: direction === 'faster' ? faster : slower,
      deltaSec,
      proposedSec,
      halfSec: Math.trunc(proposedSec / 2),
      hr,
      currentSec: Math.round(sessions[sessions.length - 1].plannedSec),
    },
  };
}

export interface PaceSuggestion {
  key: string;
  athleteId: string;
  name: string;
  /** The test this is measured against; a newer test makes it disappear. */
  basisTestDate: string;
  /** Only the kinds that moved, reps first. */
  kinds: KindEvidence[];
  /** Today's planned pace of every kind the trainee has, for the today/proposed table. */
  current: Partial<Record<PaceKind, number>>;
}

export function paceSuggestionKey(athleteId: string, basisTestDate: string): string {
  return `pace:${athleteId}:${basisTestDate}`;
}

/**
 * The pace suggestion for one trainee, or null.
 *
 * `since` is the first day whose sessions count: the later of the test and the week the
 * last pace update took effect. Sessions before an update were planned at the old paces,
 * so counting them would suggest the same change again the morning after it was made.
 */
export function detectPaceSuggestion(input: {
  athleteId: string;
  name: string;
  basisTestDate: string | null;
  since: string | null;
  sessions: PaceSession[];
  /** Zone paces from the threshold, for kinds with no session to read "today" off. */
  fallbackCurrent?: Partial<Record<PaceKind, number>>;
}): PaceSuggestion | null {
  if (!input.basisTestDate) return null;
  const since = [input.basisTestDate, input.since].filter((d): d is string => !!d).sort().pop()!;
  const sessions = input.sessions.filter(s => s.date >= since);
  const kinds = PACE_KINDS
    .map(k => checkKind(sessions, k))
    .filter((c): c is Extract<KindCheck, { qualifies: true }> => c.qualifies)
    .map(c => c.evidence);
  if (!kinds.length) return null;
  const current: Partial<Record<PaceKind, number>> = { ...(input.fallbackCurrent ?? {}) };
  for (const k of PACE_KINDS) {
    const latest = sessions.filter(s => s.kind === k).sort((a, b) => a.date.localeCompare(b.date)).pop();
    if (latest) current[k] = Math.round(latest.plannedSec);
  }
  for (const e of kinds) current[e.kind] = e.currentSec;
  return {
    key: paceSuggestionKey(input.athleteId, input.basisTestDate),
    athleteId: input.athleteId,
    name: input.name,
    basisTestDate: input.basisTestDate,
    kinds,
    current,
  };
}

/** The change a decision makes: the full proposal, or half of it. */
export function adjustFor(suggestion: Pick<PaceSuggestion, 'kinds'>, amount: 'apply' | 'half'): PaceAdjust {
  const out: PaceAdjust = {};
  for (const e of suggestion.kinds) out[e.kind] = amount === 'half' ? e.halfSec : e.proposedSec;
  return cleanAdjust(out);
}

// ── Decisions: what the coach did (migration 141's rows, or the device store) ───────────

export type DecisionKind = 'pace' | 'missed' | 'copy';

export interface CoachDecision {
  athleteId: string;
  kind: DecisionKind;
  /** pace: apply | half | snooze. missed: light | planned | repeat | talk. */
  action: string;
  basisTestDate: string | null;
  /** The plan week the decision takes effect from (pace) or is about (missed). */
  weekStart: string | null;
  /** pace: the PaceAdjust this decision added. */
  changes?: PaceAdjust | null;
  createdAt: string;
  coachName?: string | null;
  reason?: string | null;
}

export interface ActiveAdjust {
  adjust: PaceAdjust;
  /** The week the newest update applies from. Null = no update. */
  fromWeek: string | null;
  last: CoachDecision | null;
}

/**
 * The pace update in force: every apply/half made against the CURRENT test, summed. A
 * decision made against an older test is history, not a rule — the new test re-measured.
 */
export function activeAdjust(decisions: CoachDecision[], basisTestDate: string | null): ActiveAdjust {
  const live = decisions
    .filter(d => d.kind === 'pace' && (d.action === 'apply' || d.action === 'half') && !!basisTestDate && d.basisTestDate === basisTestDate)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let adjust: PaceAdjust = {};
  for (const d of live) adjust = addAdjust(adjust, cleanAdjust(d.changes ?? {}));
  const last = live[live.length - 1] ?? null;
  return { adjust, fromWeek: last?.weekStart ?? null, last };
}

/** "לא עכשיו" was said against this test, less than two weeks ago. */
export function isPaceSnoozed(decisions: CoachDecision[], athleteId: string, basisTestDate: string, nowMs: number): boolean {
  return decisions.some(d => d.kind === 'pace' && d.action === 'snooze' && d.athleteId === athleteId
    && d.basisTestDate === basisTestDate
    && Date.parse(d.createdAt) + PACE_SNOOZE_DAYS * 86_400_000 > nowMs);
}

/** The device store's "until" for a snooze. */
export function snoozeUntil(nowMs: number): number {
  return nowMs + PACE_SNOOZE_DAYS * 86_400_000;
}

/** The coach already decided this missed week. */
export function isMissedDecided(decisions: CoachDecision[], athleteId: string, weekStart: string): boolean {
  return decisions.some(d => d.kind === 'missed' && d.athleteId === athleteId && d.weekStart === weekStart);
}

// ── Applying a pace update to a planned session ───────────────────────────────────────

const clamp = (sec: number) => Math.min(MAX_PACE_SEC_PER_KM, Math.max(MIN_PACE_SEC_PER_KM, Math.round(sec)));

function shiftStep(step: WorkoutStep, thresholdSec: number, target: PaceAdjust, applied: PaceAdjust): WorkoutStep {
  const out: WorkoutStep = { ...step };
  if (out.repeatSteps) out.repeatSteps = out.repeatSteps.map(s => shiftStep(s, thresholdSec, target, applied));
  if (!pacedStep(out)) return out;
  const c = centre(out.targetPaceMinPerKm, out.targetPaceMaxPerKm)!;
  // Classified on the pace as it stands; an update is at most 15 s/km, so the boundary
  // between kinds is not crossed by the update itself in any real case.
  // The same classification the book's screens show a pace with (pace-kinds.ts).
  const by = kindShift(c, thresholdSec, target) - kindShift(c, thresholdSec, applied);
  if (!by) return out;
  if (typeof out.targetPaceMinPerKm === 'number') out.targetPaceMinPerKm = clamp(out.targetPaceMinPerKm + by);
  if (typeof out.targetPaceMaxPerKm === 'number') out.targetPaceMaxPerKm = clamp(out.targetPaceMaxPerKm + by);
  if (out.notes) out.notes = shiftPacesInNotes(out.notes, by);
  return out;
}

/**
 * One planned session at the pace update `target`, from whatever update it already carries
 * (`workout.paceAdjust`). Idempotent: applying the same target twice changes nothing, and a
 * second update shifts only by the difference. No threshold = no kinds = untouched.
 */
export function applyPaceAdjust(workout: ParsedWorkout, thresholdSec: number | null, target: PaceAdjust): ParsedWorkout {
  if (!thresholdSec || !(thresholdSec > 0)) return workout;
  const applied = cleanAdjust(workout.paceAdjust);
  const goal = cleanAdjust(target);
  if (PACE_KINDS.every(k => (applied[k] ?? 0) === (goal[k] ?? 0))) return workout;
  const out: ParsedWorkout = { ...workout, steps: workout.steps.map(s => shiftStep(s, thresholdSec, goal, applied)) };
  if (Object.keys(goal).length) out.paceAdjust = goal;
  else delete out.paceAdjust;
  return out;
}

/** The main work's planned pace, sec/km — what a row's pace column shows. */
export function mainPaceOf(workout: Pick<ParsedWorkout, 'steps'>): number | null {
  const flat: WorkoutStep[] = [];
  const walk = (steps: WorkoutStep[]) => steps.forEach(s => { flat.push(s); if (s.repeatSteps) walk(s.repeatSteps); });
  walk(workout.steps);
  const work = flat.filter(s => pacedStep(s) && s.type !== 'warmup' && s.type !== 'cooldown' && s.type !== 'rest' && s.type !== 'recovery');
  const pick = work.find(s => s.type === 'interval') ?? work[0] ?? flat.find(pacedStep);
  if (!pick) return null;
  return Math.round(centre(pick.targetPaceMinPerKm, pick.targetPaceMaxPerKm)!);
}

// ── 2 · Missed workouts ────────────────────────────────────────────────────────────────

export interface WeekSession {
  date: string;
  dayOfWeek: number;
  /** `6×800`, `5×1K`, `טמפו`, `16K`. */
  label: string;
  color: ComplianceColor;
  isLong: boolean;
  plannedM: number | null;
}

export interface WeekOfSessions {
  weekStart: string;
  sessions: WeekSession[];
}

export interface MissedFinding {
  weekStart: string;
  missed: number;
  planned: number;
  /** 'week' = 2+ missed in the week; 'long' = the last two long runs both missed. */
  rule: 'week' | 'long';
}

/** Missed in the week and on the long runs, before the rule decides. */
export const MISSED_PER_WEEK = 2;

/**
 * The week a coach should decide about, or null. The current week first (only its days
 * before today can be missed), then the week before. Else the long-run rule: the last two
 * long runs on the calendar were both missed, whichever weeks they fell in.
 */
export function detectMissed(weeks: WeekOfSessions[], today: string): MissedFinding | null {
  const ordered = [...weeks].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  const past = ordered.filter(w => w.weekStart <= today).slice(0, 2);
  for (const w of past) {
    const missed = w.sessions.filter(s => s.color === 'red' && s.date < today).length;
    if (missed >= MISSED_PER_WEEK) return { weekStart: w.weekStart, missed, planned: w.sessions.length, rule: 'week' };
  }
  const longs = ordered.flatMap(w => w.sessions.filter(s => s.isLong && s.date < today).map(s => ({ s, week: w })))
    .sort((a, b) => b.s.date.localeCompare(a.s.date));
  if (longs.length >= 2 && longs[0].s.color === 'red' && longs[1].s.color === 'red') {
    const w = longs[0].week;
    return { weekStart: w.weekStart, missed: w.sessions.filter(s => s.color === 'red').length, planned: w.sessions.length, rule: 'long' };
  }
  return null;
}

export type NoteReason = 'sick' | 'pain';

const SICK = /חול[הים]|חולה|מחל[הת]|חום|צינון|שפעת|וירוס|קורונה|גרון|שיעול|משתעל|מצונן|הקאות|קיבה|sick|ill\b|fever|flu|cold\b/i;
const PAIN = /כא[בו]|כואב|פציע|נפצע|פצוע|נקע|דלקת|שין|ברך|גיד|קרסול|שריר|מתיחה|ירך|כף רגל|pain|injur|hurt|sore/i;

/** What a trainee's own note says about why: sick, pain, or neither. */
export function noteReason(text: string | null | undefined, painFlag = false): NoteReason | null {
  const t = (text ?? '').trim();
  if (SICK.test(t)) return 'sick';
  if (painFlag || PAIN.test(t)) return 'pain';
  return null;
}

export interface TraineeNote {
  text: string;
  at: string;
  pain?: boolean;
}

/**
 * The note the missed screen quotes: the newest one that names a reason, else the newest
 * at all. Notes before `since` are about something else.
 */
export function pickNote(notes: TraineeNote[], since: string): (TraineeNote & { reason: NoteReason | null }) | null {
  const recent = notes.filter(n => n.text.trim() && n.at.slice(0, 10) >= since).sort((a, b) => b.at.localeCompare(a.at));
  const withReason = recent.find(n => noteReason(n.text, n.pain) !== null);
  const pick = withReason ?? recent[0];
  return pick ? { ...pick, reason: noteReason(pick.text, pick.pain) } : null;
}

export type MissedOption = 'light' | 'planned' | 'repeat' | 'talk';
export const MISSED_OPTIONS: readonly MissedOption[] = ['light', 'planned', 'repeat', 'talk'];

/** Sick or in pain → the lighter week. Otherwise the coach talks to them first. */
export function preselectMissed(reason: NoteReason | null): MissedOption {
  return reason ? 'light' : 'talk';
}

export function missedKey(athleteId: string, weekStart: string): string {
  return `missed:${athleteId}:${weekStart}`;
}

// ── 3 · Progression: the same week, a little more, or lighter ─────────────────────────

export type Progression = 'same' | 'plus5' | 'plus10' | 'light';
export const PROGRESSIONS: readonly Progression[] = ['same', 'plus5', 'plus10', 'light'];

/** A light week's share of the volume. The mockup's 70%. */
export const LIGHT_SHARE = 0.7;

export type StepChange =
  /** "7 חזרות במקום 6" */
  | { type: 'count'; from: number; to: number }
  /** "החזרות 2.2 ק״מ במקום 2" */
  | { type: 'repLength'; measure: Length['measure']; from: number; to: number }
  /** "17 ק״מ במקום 16" */
  | { type: 'length'; measure: Length['measure']; from: number; to: number }
  /** "ריצה קלה 3.5 ק״מ במקום החזרות" */
  | { type: 'easyInstead'; measure: Length['measure']; to: number };

const roundTo = (v: number, unit: number) => Math.round(v / unit) * unit;

/** The rounding a coach would write: 100 m reps, half-km runs, 15 s reps, whole minutes. */
function unitFor(measure: Length['measure'], value: number, isRep: boolean): number {
  if (measure === 'time') return isRep ? 15 : 60;
  if (isRep) return 100;
  return value >= 3000 ? 500 : 100;
}

const share = (pct: Progression) => (pct === 'plus5' ? 0.05 : pct === 'plus10' ? 0.1 : 0);

/**
 * A session made a little bigger: one more rep, or longer reps, or a longer run. Never a
 * different pace — the mockup's rule: "+5% נפח מוסיף חזרה או מאריך, ולא משנה קצב".
 *
 * The extra is the share of the SESSION's volume (in its main step's own measure), turned
 * into the nearest thing a coach writes. A short rep is added whole (6×800 → 7×800); a long
 * rep is lengthened instead (3×2 ק״מ → 3×2.2 ק״מ), because a fourth 2 km rep is a different
 * session. When nothing a coach would write is close, the session stays as it is.
 */
function growModel(steps: BookStep[], pct: number, thresholdSec: number | null): { steps: BookStep[]; changes: StepChange[] } {
  const i = mainStepIndex(steps);
  if (i < 0) return { steps, changes: [] };
  const main = steps[i];
  const totals = bookTotals(steps, thresholdSec);
  const out = [...steps];

  if (main.kind === 'reps') {
    const measure = main.work.measure;
    const volume = measure === 'distance' ? totals.distanceM : totals.durationSec;
    const target = volume * pct;
    if (!(target > 0)) return { steps, changes: [] };
    if (main.work.value <= target * 2) {
      const add = Math.max(1, Math.round(target / main.work.value));
      out[i] = { ...main, count: main.count + add };
      return { steps: out, changes: [{ type: 'count', from: main.count, to: main.count + add }] };
    }
    const unit = unitFor(measure, main.work.value, true);
    const per = roundTo(target / main.count, unit);
    if (per <= 0) return { steps, changes: [] };
    const to = main.work.value + per;
    out[i] = { ...main, work: { ...main.work, value: to } };
    return { steps: out, changes: [{ type: 'repLength', measure, from: main.work.value, to }] };
  }

  if (main.kind === 'run' && main.length) {
    const { measure, value } = main.length;
    const volume = measure === 'distance' ? totals.distanceM : totals.durationSec;
    const add = roundTo(volume * pct, unitFor(measure, value, false));
    if (add <= 0) return { steps, changes: [] };
    out[i] = { ...main, length: { measure, value: value + add } };
    return { steps: out, changes: [{ type: 'length', measure, from: value, to: value + add }] };
  }
  return { steps, changes: [] };
}

/**
 * The light version: 70% of the volume and no fast reps. A set of fast reps becomes an easy
 * run of 70% of their length; slower reps keep their shape with fewer of them; every run
 * is shortened. Only the main step's change is reported — the words a coach reads.
 */
function lightModel(steps: BookStep[], thresholdSec: number | null): { steps: BookStep[]; changes: StepChange[] } {
  const mi = mainStepIndex(steps);
  const changes: StepChange[] = [];
  const out: BookStep[] = steps.map((s, i) => {
    if (s.kind === 'reps') {
      if (toneOf(s.effort) === 'f') {
        const measure = s.work.measure;
        const to = Math.max(unitFor(measure, s.work.value * s.count, false), roundTo(s.work.value * s.count * LIGHT_SHARE, unitFor(measure, s.work.value * s.count, false)));
        if (i === mi) changes.push({ type: 'easyInstead', measure, to });
        return { kind: 'run', role: 'main', length: { measure, value: to }, effort: effortFromZone('easy') } as BookStep;
      }
      const to = Math.max(1, Math.round(s.count * LIGHT_SHARE));
      if (i === mi && to !== s.count) changes.push({ type: 'count', from: s.count, to });
      return { ...s, count: to };
    }
    if (s.kind === 'run' && s.length) {
      const { measure, value } = s.length;
      const to = Math.max(unitFor(measure, value, false), roundTo(value * LIGHT_SHARE, unitFor(measure, value, false)));
      const effort = s.effort && toneOf(s.effort) === 'f' ? effortFromZone('easy') : s.effort;
      if (i === mi && to !== value) changes.push({ type: 'length', measure, from: value, to });
      return { ...s, length: { measure, value: to }, effort };
    }
    if (s.kind === 'hr') {
      const to = Math.max(60, roundTo(s.seconds * LIGHT_SHARE, 60));
      if (i === mi && to !== s.seconds) changes.push({ type: 'length', measure: 'time', from: s.seconds, to });
      return { ...s, seconds: to };
    }
    return s;
  });
  void thresholdSec;
  return { steps: out, changes };
}

/** A session's steps after a progression, and what changed in words-ready form. */
export function progressModel(
  steps: BookStep[],
  mode: Progression,
  thresholdSec: number | null,
  times = 1,
): { steps: BookStep[]; changes: StepChange[] } {
  if (mode === 'same' || times < 1) return { steps, changes: [] };
  if (mode === 'light') return lightModel(steps, thresholdSec);
  let cur = steps;
  for (let k = 0; k < times; k++) cur = growModel(cur, share(mode), thresholdSec).steps;
  const changes = diffMain(steps, cur);
  return { steps: cur, changes };
}

/** The main step's change between two models, for a progression applied several times. */
function diffMain(before: BookStep[], after: BookStep[]): StepChange[] {
  const i = mainStepIndex(before);
  if (i < 0) return [];
  const a = before[i], b = after[i];
  if (a.kind === 'reps' && b.kind === 'reps') {
    const out: StepChange[] = [];
    if (a.count !== b.count) out.push({ type: 'count', from: a.count, to: b.count });
    if (a.work.value !== b.work.value) out.push({ type: 'repLength', measure: a.work.measure, from: a.work.value, to: b.work.value });
    return out;
  }
  if (a.kind === 'run' && b.kind === 'run' && a.length && b.length && a.length.value !== b.length.value) {
    return [{ type: 'length', measure: a.length.measure, from: a.length.value, to: b.length.value }];
  }
  return [];
}

// ── Copying a session for one trainee ─────────────────────────────────────────────────

/** A step with its pace taken off: what a trainee with no test gets. */
function unpace(step: WorkoutStep): WorkoutStep {
  const { targetPaceMinPerKm, targetPaceMaxPerKm, group2Pace, group3Pace, ...rest } = step;
  void targetPaceMinPerKm; void targetPaceMaxPerKm; void group2Pace; void group3Pace;
  const out: WorkoutStep = { ...rest };
  if (out.targetType === 'pace') {
    out.targetType = 'no_target';
    if (out.notes) out.notes = out.notes.replace(/\d{1,2}:\d{2}(\s*[-–]\s*\d{1,2}:\d{2})?/g, '').replace(/\s{2,}/g, ' ').trim() || undefined;
    if (!out.notes) delete out.notes;
  }
  if (out.repeatSteps) out.repeatSteps = out.repeatSteps.map(unpace);
  return out;
}

export interface CopiedWorkout {
  workout: ParsedWorkout;
  changes: StepChange[];
  /** False: the trainee has no test, so the copy carries no paces. */
  paced: boolean;
  /** False: the session's shape could not be modelled, so it was copied without a progression. */
  modelled: boolean;
  /** Planned distance after the progression, metres. */
  distanceM: number;
}

/**
 * One session copied to one trainee: restated against the threshold it was written for,
 * progressed, and resolved again from the target's own threshold (and pace update).
 *
 * `sourceThresholdSec` null = the source trainee has no test, so the paces as stored are
 * nobody's threshold: a copy to anyone ELSE goes without paces. A copy to the source
 * themselves keeps them (`sameTrainee`), restated against the typical threshold and back,
 * which is the identity up to a second of rounding.
 */
export function copyWorkout(input: {
  workout: ParsedWorkout;
  sourceThresholdSec: number | null;
  targetThresholdSec: number | null;
  targetAdjust?: PaceAdjust;
  sameTrainee?: boolean;
  mode: Progression;
  /** The week's position in a multi-week copy: week 2 gets the progression twice. */
  times?: number;
  dayOfWeek?: number;
  /** The progression already decided for the whole week (`copyWeek`); skips `mode`. */
  progressed?: { steps: BookStep[]; changes: StepChange[] } | null;
}): CopiedWorkout {
  const { mode } = input;
  // The source's own pace update comes off first: it is theirs, not the session's. The
  // target's goes on at the end (a copy to oneself puts the same one back).
  const workout = input.sourceThresholdSec ? applyPaceAdjust(input.workout, input.sourceThresholdSec, {}) : input.workout;
  const dayOfWeek = input.dayOfWeek ?? workout.dayOfWeek;
  const same = !!input.sameTrainee;
  const ref = input.sourceThresholdSec ?? (same ? ESTIMATE_THRESHOLD_SEC : null);
  const target = same && !input.sourceThresholdSec ? ESTIMATE_THRESHOLD_SEC : input.targetThresholdSec;

  const lib: LibraryStep[] = absoluteToLibrary(workout.steps, ref ?? ESTIMATE_THRESHOLD_SEC).steps;
  const model = fromLibrarySteps(lib);
  let steps: LibraryStep[] = lib;
  let changes: StepChange[] = [];
  let name = workout.name;
  let distanceM = model ? bookTotals(model, target ?? null).distanceM : 0;
  if (model) {
    const progressed = input.progressed ?? progressModel(model, mode, target ?? null, input.times ?? 1);
    steps = toLibrarySteps(progressed.steps);
    changes = progressed.changes;
    name = changes.length || /^(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)$/.test(workout.name.trim()) ? structureName(progressed.steps) : workout.name;
    distanceM = bookTotals(progressed.steps, target ?? null).distanceM;
  }

  const base: ParsedWorkout = {
    dayOfWeek,
    name,
    ...(workout.description ? { description: workout.description } : {}),
    steps: [],
  };
  if (ref && target) {
    const resolved = resolveLibraryWorkout({ name, notes: workout.description ?? null, steps }, { thresholdPaceSec: target, dayOfWeek });
    if (resolved) {
      const adjusted = applyPaceAdjust({ ...resolved, paceAdjust: undefined }, target, same && !input.sourceThresholdSec ? {} : input.targetAdjust ?? {});
      return { workout: adjusted, changes, paced: true, modelled: !!model, distanceM };
    }
  }
  // No paces: the shape only. Resolved against the typical threshold for lengths, then the
  // pace targets are taken off, so the watch gets distances and rests and no alarm.
  const shaped = resolveLibraryWorkout({ name, notes: workout.description ?? null, steps }, { thresholdPaceSec: ESTIMATE_THRESHOLD_SEC, dayOfWeek });
  return {
    workout: { ...base, steps: (shaped?.steps ?? workout.steps).map(unpace) },
    changes,
    paced: false,
    modelled: !!model,
    distanceM,
  };
}

/**
 * +5% / +10% decided for the WEEK, not per session: every session offers the one change a
 * coach would write for it (`growModel`), and the set whose extra comes closest to the
 * week's share is taken (ties: more sessions touched, then the earlier ones). So "+5%"
 * lands near 5% of the week instead of each session rounding up on its own — and a session
 * that is left alone says "ללא שינוי". Applied `times` times for a multi-week copy.
 */
export function balanceWeek(models: Array<BookStep[] | null>, pct: number, refSec: number | null, times = 1): Array<{ steps: BookStep[]; changes: StepChange[] } | null> {
  let cur = models.map(m => (m ? [...m] : null));
  for (let k = 0; k < Math.max(1, times); k++) {
    const total = cur.reduce((sum, m) => sum + (m ? bookTotals(m, refSec).distanceM : 0), 0);
    const goal = total * pct;
    const options = cur.map(m => {
      if (!m) return null;
      const grown = growModel(m, pct, refSec);
      if (!grown.changes.length) return null;
      return { steps: grown.steps, extra: bookTotals(grown.steps, refSec).distanceM - bookTotals(m, refSec).distanceM };
    });
    const idx = options.map((o, i) => (o ? i : -1)).filter(i => i >= 0);
    let best: { mask: number; gap: number; n: number } = { mask: 0, gap: goal, n: 0 };
    for (let mask = 1; mask < 1 << idx.length; mask++) {
      let extra = 0, n = 0;
      idx.forEach((i, b) => { if (mask & (1 << b)) { extra += options[i]!.extra; n += 1; } });
      const gap = Math.abs(extra - goal);
      if (gap < best.gap - 1 || (Math.abs(gap - best.gap) <= 1 && n > best.n)) best = { mask, gap, n };
    }
    cur = cur.map((m, i) => {
      const b = idx.indexOf(i);
      return b >= 0 && best.mask & (1 << b) ? options[i]!.steps : m;
    });
  }
  return cur.map((m, i) => (m && models[i] ? { steps: m, changes: diffMain(models[i]!, m) } : null));
}

/** A whole week, copied (sorted by day). */
export function copyWeek(input: Omit<Parameters<typeof copyWorkout>[0], 'workout' | 'dayOfWeek' | 'progressed'> & { workouts: ParsedWorkout[] }): CopiedWorkout[] {
  const sorted = [...input.workouts].sort((a, b) => a.dayOfWeek - b.dayOfWeek || (a.partIndex ?? 0) - (b.partIndex ?? 0));
  if (input.mode !== 'plus5' && input.mode !== 'plus10') return sorted.map(w => copyWorkout({ ...input, workout: w }));
  // The shape is decided once, against the SOURCE's threshold, so every trainee gets the same
  // sessions; each still gets their own paces below.
  const ref = input.sourceThresholdSec ?? ESTIMATE_THRESHOLD_SEC;
  const models = sorted.map(w => {
    const base = input.sourceThresholdSec ? applyPaceAdjust(w, input.sourceThresholdSec, {}) : w;
    return fromLibrarySteps(absoluteToLibrary(base.steps, ref).steps);
  });
  const plan = balanceWeek(models, share(input.mode), ref, input.times ?? 1);
  return sorted.map((w, i) => copyWorkout({ ...input, workout: w, progressed: plan[i] }));
}

export interface CopyCandidate {
  id: string;
  name: string;
  /** Workouts already planned in each target week. */
  existing: Record<string, number>;
}

/**
 * Who starts ticked: everybody whose target weeks are empty. Somebody who already has
 * workouts there starts unticked, and the row says how many would be replaced — ticking
 * them replaces those weeks.
 */
export function copyDefaults(candidates: CopyCandidate[], weeks: string[]): Array<{ id: string; ticked: boolean; replaces: number }> {
  return candidates.map(c => {
    const replaces = weeks.reduce((n, w) => n + (c.existing[w] ?? 0), 0);
    return { id: c.id, ticked: replaces === 0, replaces };
  });
}

/** The plan weeks a copy goes to: the next one, or the next `n`. */
export function targetWeeks(sourceWeek: string, n: number): string[] {
  const out: string[] = [];
  for (let k = 1; k <= Math.max(1, Math.min(4, n)); k++) {
    const d = new Date(`${sourceWeek}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * k);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// ── Labels ────────────────────────────────────────────────────────────────────────────

const kmShort = (m: number) => {
  const km = Math.round(m / 100) / 10;
  return `${Number.isInteger(km) ? km : km.toFixed(1)}K`;
};

/**
 * The square's label: `6×800`, `5×1K`, `טמפו`, `16K`. Digits and Latin only except the one
 * word, so it renders inside an LTR isolate.
 */
export function squareLabel(workout: Pick<ParsedWorkout, 'steps' | 'name'>, referenceSec: number | null): string {
  const lib = absoluteToLibrary(workout.steps, referenceSec ?? ESTIMATE_THRESHOLD_SEC).steps;
  const model = fromLibrarySteps(lib);
  if (!model) return workout.name;
  const i = mainStepIndex(model);
  const main = i >= 0 ? model[i] : null;
  if (main?.kind === 'reps') {
    if (toneOf(main.effort) === 't') return 'טמפו';
    const len = main.work.measure === 'time'
      ? `${Math.round(main.work.value / 60)}′`
      : main.work.value >= 1000 ? kmShort(main.work.value) : String(main.work.value);
    return `${main.count}×${len}`;
  }
  if (main?.kind === 'run' && main.effort && toneOf(main.effort) === 't') return 'טמפו';
  const total = bookTotals(model, referenceSec).distanceM;
  return total > 0 ? kmShort(total) : workout.name;
}

/** A long run: an easy session of 14 km or more, or one the coach called long. */
export function isLongRun(workout: Pick<ParsedWorkout, 'steps' | 'name' | 'description'>, referenceSec: number | null): boolean {
  if (/ארוכ/.test(`${workout.name} ${workout.description ?? ''}`)) return true;
  const model = fromLibrarySteps(absoluteToLibrary(workout.steps, referenceSec ?? ESTIMATE_THRESHOLD_SEC).steps);
  if (!model) return false;
  const i = mainStepIndex(model);
  const main = i >= 0 ? model[i] : null;
  if (main && main.kind !== 'run') return false;
  if (main?.effort && toneOf(main.effort) !== 'e') return false;
  return bookTotals(model, referenceSec).distanceM >= 14000;
}

export const fmt = formatPace;
