import type { SegmentReport, SegmentVerdict } from './segments';
import { lengthLabel } from './segments';

// ── The uniform weekly feedback ─────────────────────────────────────────────
//
// One mentor reviews a trainee's week and writes back. Today that happens in
// WhatsApp in free language, so the feedback is as good or as thin as whichever
// mentor wrote it, and nothing about it can be counted, compared over time, or
// handed to a new mentor. The whole point of this module is that the mentor
// CHOOSES from a fixed vocabulary and the sentence is GENERATED from the choice —
// same words for the same situation, every mentor, every week.
//
// Two consequences worth naming, because they are the reasons this exists:
//  · a mentor who picks four chips and writes one line spends well under a minute
//    on a workout, which is what makes it affordable to add mentors;
//  · because the tags are a closed set, "he opens too fast" becomes a countable
//    fact about a trainee over months instead of a feeling somebody once typed.
//
// The free-text note is kept — deliberately small — because no closed vocabulary
// ever covers the thing that actually mattered this week.

/** What happened in the session. Multi-select: a run can open too fast AND fade. */
export type ExecutionTag =
  | 'on_plan'
  | 'fast_start'
  | 'faded'
  | 'uneven'
  | 'too_fast'
  | 'too_slow'
  | 'short_volume'
  | 'extra_volume'
  | 'strong_finish'
  | 'hr_high'
  | 'hr_low';

/** How hard it was — the one thing only the trainee knows and the data cannot say. */
export type EffortTag = 'easy' | 'right' | 'hard' | 'too_hard';

/** What changes because of this. The mentor's actual decision. */
export type ActionTag = 'keep' | 'ease_next' | 'push_next' | 'needs_talk' | 'health_check';

export const EXECUTION_LABELS: Record<ExecutionTag, string> = {
  on_plan: 'בוצע לפי התוכנית',
  fast_start: 'פתיחה מהירה מדי',
  faded: 'דעיכה לקראת הסוף',
  uneven: 'פיזור גדול בין החזרות',
  too_fast: 'מהיר מהמתוכנן',
  too_slow: 'איטי מהמתוכנן',
  short_volume: 'נפח חסר',
  extra_volume: 'נפח עודף',
  strong_finish: 'סגירה חזקה',
  hr_high: 'דופק גבוה מהיעד',
  hr_low: 'דופק נמוך מהיעד',
};

export const EFFORT_LABELS: Record<EffortTag, string> = {
  easy: 'קל',
  right: 'מתאים',
  hard: 'קשה',
  too_hard: 'קשה מדי',
};

export const ACTION_LABELS: Record<ActionTag, string> = {
  keep: 'ממשיכים לפי התוכנית',
  ease_next: 'מרככים את האימון הבא',
  push_next: 'אפשר להעלות רמה',
  needs_talk: 'צריך שיחה',
  health_check: 'לשים לב לבריאות',
};

/** A comment on one specific lap — the level of detail no tool they use today has. */
export interface LapComment {
  /** `SegmentVerdict.index` — the planned step, not the watch's lap number. */
  index: number;
  text: string;
}

export interface WorkoutFeedback {
  execution: ExecutionTag[];
  effort: EffortTag | null;
  action: ActionTag | null;
  lapComments: LapComment[];
  /** The one free-text field. Capped: see NOTE_MAX. */
  note: string;
}

/**
 * 240 characters. Long enough for the thing the chips could not say, short enough
 * that it cannot quietly become the WhatsApp paragraph this module replaced — which
 * is the failure mode to design against, not typing effort.
 */
export const NOTE_MAX = 240;
export const LAP_COMMENT_MAX = 120;

export function emptyFeedback(): WorkoutFeedback {
  return { execution: [], effort: null, action: null, lapComments: [], note: '' };
}

export interface FeedbackProblem {
  field: 'execution' | 'action' | 'note' | 'lapComments';
  message: string;
}

/**
 * What a mentor must supply for this to be feedback rather than a tick-box.
 *
 * Only two things are required: WHAT happened and WHAT CHANGES. Effort is optional
 * because it is the trainee's to report, and the note is optional by design.
 */
export function validateFeedback(fb: WorkoutFeedback): FeedbackProblem[] {
  const out: FeedbackProblem[] = [];
  if (fb.execution.length === 0) out.push({ field: 'execution', message: 'בחר לפחות תיאור אחד של הביצוע' });
  if (!fb.action) out.push({ field: 'action', message: 'בחר מה קורה מכאן' });
  if (fb.note.length > NOTE_MAX) out.push({ field: 'note', message: `ההערה ארוכה מ-${NOTE_MAX} תווים` });
  if (fb.lapComments.some(c => c.text.length > LAP_COMMENT_MAX)) {
    out.push({ field: 'lapComments', message: `הערה ל-lap ארוכה מ-${LAP_COMMENT_MAX} תווים` });
  }
  if (fb.execution.includes('on_plan') && fb.execution.length > 1) {
    out.push({ field: 'execution', message: '"בוצע לפי התוכנית" לא הולך יחד עם הערה על חריגה' });
  }
  return out;
}

// ── Reading the run for the mentor ──────────────────────────────────────────

/** sec/km deviation of a segment from its band: negative = faster than asked. */
export function deviationOf(seg: SegmentVerdict): number | null {
  if (seg.metric === 'pace') {
    if (seg.actualPace == null || seg.plannedPaceMin == null || seg.plannedPaceMax == null) return null;
    if (seg.actualPace < seg.plannedPaceMin) return seg.actualPace - seg.plannedPaceMin;
    if (seg.actualPace > seg.plannedPaceMax) return seg.actualPace - seg.plannedPaceMax;
    return 0;
  }
  if (seg.metric === 'hr') {
    if (seg.actualHr == null || seg.plannedHrMin == null || seg.plannedHrMax == null) return null;
    // Kept in the same sign convention as pace: negative = harder than asked. A heart
    // rate ABOVE the band is the harder side, so the sign is inverted from the raw bpm
    // difference on purpose — one rule reads both metrics.
    if (seg.actualHr > seg.plannedHrMax) return seg.plannedHrMax - seg.actualHr;
    if (seg.actualHr < seg.plannedHrMin) return seg.plannedHrMin - seg.actualHr;
    return 0;
  }
  return null;
}

/**
 * The tags the DATA already supports, pre-selected for the mentor.
 *
 * This is the minute-saver: the mentor arrives at a screen that already says "opened
 * too fast and faded" and either agrees or corrects it, instead of reading twelve laps
 * and composing a sentence. It never sets `effort` (the trainee's to report) and never
 * sets `action` (the mentor's decision, and the one thing that must not be automated —
 * a form that pre-picks the decision gets rubber-stamped).
 */
export function suggestExecutionTags(report: SegmentReport): ExecutionTag[] {
  const work = report.segments.filter(s => (s.graded || s.metric === 'hr') && s.status !== 'unknown');
  if (work.length === 0) return [];

  const devs = work.map(deviationOf).filter((d): d is number => d != null);
  if (devs.length === 0) return [];

  const out: ExecutionTag[] = [];
  const fast = work.filter(s => s.status === 'faster');
  const slow = work.filter(s => s.status === 'slower');
  const onTarget = work.length - fast.length - slow.length;

  const spread = Math.max(...devs) - Math.min(...devs);
  const half = Math.ceil(work.length / 2);
  const firstDevs = devs.slice(0, half);
  const lastDevs = devs.slice(-half);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  if (onTarget === work.length) out.push('on_plan');

  // Opened too fast: the first half was over the line on the hard side, and the run
  // did not simply stay there — that is a different tag (too_fast).
  const openedHot = work.length >= 4 && avg(firstDevs) < -HOT_START_SEC && avg(lastDevs) > avg(firstDevs) + HOT_START_SEC;
  if (openedHot) out.push('fast_start');

  // Faded: the back half is meaningfully softer than the front half.
  if (work.length >= 4 && avg(lastDevs) > avg(firstDevs) + FADE_SEC) out.push('faded');
  // Strong finish: the opposite, and worth saying — it is the shape a coach wants.
  if (work.length >= 4 && avg(lastDevs) < avg(firstDevs) - FADE_SEC && !openedHot) out.push('strong_finish');

  if (spread >= SPREAD_SEC && work.length >= 3) out.push('uneven');
  if (!openedHot && fast.length > work.length / 2) out.push(hrMajority(work) ? 'hr_high' : 'too_fast');
  if (slow.length > work.length / 2) out.push(hrMajority(work) ? 'hr_low' : 'too_slow');

  return dedupe(out);
}

/** Above this many sec/km over the band, an opening is hot rather than brisk. */
const HOT_START_SEC = 6;
/** Front half to back half, in sec/km, before it is a fade rather than noise. */
const FADE_SEC = 8;
/** Best rep to worst rep, in sec/km, before the set is uneven rather than human. */
const SPREAD_SEC = 15;

function hrMajority(work: SegmentVerdict[]): boolean {
  return work.filter(s => s.metric === 'hr').length > work.length / 2;
}

function dedupe<T>(xs: T[]): T[] {
  return xs.filter((x, i) => xs.indexOf(x) === i);
}

// ── The sentence the trainee reads ──────────────────────────────────────────

export interface FeedbackContext {
  /** Workout name as the plan called it, e.g. "6×1000 מ׳ בקצב סף". */
  workoutName: string;
  /** Mentor's display name — the feedback is signed, because it is a person's. */
  mentorName?: string;
  /** Segment verdicts, so lap comments can be printed with the lap they belong to. */
  segments?: SegmentVerdict[];
}

/**
 * Render the structured feedback as the Hebrew the trainee actually receives.
 *
 * Deterministic and generated, not typed: this is the single place the club's
 * feedback language is defined, so changing how feedback reads is a change here
 * rather than a message to eight mentors.
 *
 * The output is stored alongside the structured answers rather than re-rendered on
 * read: a message the trainee already received must not re-word itself later because
 * the club changed its phrasing. New wording applies to new feedback.
 */
export function renderFeedbackHebrew(fb: WorkoutFeedback, ctx: FeedbackContext): string {
  const lines: string[] = [];
  lines.push(ctx.workoutName);

  if (fb.execution.length) {
    lines.push(fb.execution.map(t => EXECUTION_LABELS[t]).join(' · '));
  }
  if (fb.effort) lines.push(`תחושה: ${EFFORT_LABELS[fb.effort]}`);

  for (const c of fb.lapComments) {
    if (!c.text.trim()) continue;
    lines.push(`${lapLabel(c.index, ctx.segments)}: ${c.text.trim()}`);
  }

  if (fb.note.trim()) lines.push(fb.note.trim());
  if (fb.action) lines.push(ACTION_LABELS[fb.action]);
  if (ctx.mentorName) lines.push(`— ${ctx.mentorName}`);

  return lines.join('\n');
}

/**
 * Is this Postgres error "the feedback table isn't there yet"?
 *
 * Migration 103 is applied by hand, so every route that touches
 * `academy_workout_feedback` has to tell a missing table apart from a real
 * failure: the first means "nobody has written feedback yet", which every screen
 * can render, and the second is a 500. Lives here rather than in one route
 * because the queue needs the same distinction and a second copy of these three
 * error codes would drift from this one.
 */
export function isMissingFeedbackTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01'
    || error.code === 'PGRST205'
    || /does not exist|could not find the table/i.test(error.message || '');
}

/**
 * How a lap is named in the feedback text.
 *
 * By the planned step it was, not by the watch's lap number: "חזרה 4" is what the
 * trainee and the mentor both mean, while "lap 8" is an artefact of the warmup and
 * the recoveries having taken laps of their own.
 */
export function lapLabel(index: number, segments?: SegmentVerdict[]): string {
  const seg = segments?.find(s => s.index === index);
  if (!seg) return `חזרה ${index + 1}`;
  const work = segments!.filter(s => s.graded || s.metric === 'hr');
  const nth = work.findIndex(s => s.index === index);
  const length = lengthLabel(seg.actualDistanceM, null);
  if (nth >= 0) return `חזרה ${nth + 1}${length ? ` (${length})` : ''}`;
  return seg.label;
}
