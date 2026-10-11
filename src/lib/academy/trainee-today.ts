// The trainee's day on the home (mockup trainee-experience-v2, phones 1, 1ב and 1ג), as
// pure functions.
//
// GET /api/academy/today reads the rows; everything it then DECIDES — whether today is a
// workout, a rest day or a week with no plan at all, which day the card is about after
// 20:00, what the workout card says, whether the test invitation earns the top slot, what
// the form card and the two body chips say — is decided here, tested, and only drawn by
// components/trainee. No DB, no clock (every function that needs "today" is given it), no
// next-intl (keys and numbers only; the components translate with the trainee's gender).

import type { ParsedWorkout } from '@/lib/ai/types';
import type { PaceUpdateCard } from './coach-tools-payload';
import type { TestInvitation } from './testInvite';
import {
  absoluteToLibrary, bookTotals, effortPace, fromLibrarySteps, mainStepIndex, profileBar, structureName, toneOf,
  type BarSegment, type BookStep,
} from './book-steps';
import { shiftDate, type LoadSource, type TestPoint } from './load';
import { buildLoadPayload } from './load-payload';
import { formBand, formSentenceKey, isHeavyWeek, type DayKind, type FormBandKey } from './form-bands';
import {
  isLearning, normalRange, rhrVerdict, sleepVerdict,
  type RangeField, type RhrVerdict, type SleepVerdict, type WellnessNight,
} from './normal-range';
import type { LoadRow, LoadStatus } from './pmc';

// ── Which kind of day ────────────────────────────────────────────────────────────────────

export type HomeDayState = 'workout' | 'rest' | 'noPlan';

/**
 * Workout, rest, or no plan at all — the question the club home got wrong: a week WITH a
 * plan and nothing on it today said "אין תוכנית" and offered to upload one (mockup 1ב).
 *
 * - `noPlan`: no plan row at all for the week (and nothing tomorrow either).
 * - `rest`: the week has a plan, today has no session.
 * - `workout`: today has a session. On the club home "today" stretches to tomorrow: that
 *   card has always shown the NEXT workout when today is empty (c1334a75). The academy home
 *   is the mockup's: only today is a workout day, and tomorrow is the mini card under the
 *   rest card.
 */
export function homeDayState(input: {
  hasPlan: boolean;
  today: unknown;
  tomorrow: unknown;
  isAcademy: boolean;
}): HomeDayState {
  if (input.today) return 'workout';
  if (!input.isAcademy && input.tomorrow) return 'workout';
  if (input.hasPlan || input.tomorrow) return 'rest';
  return 'noPlan';
}

/**
 * The "upload a plan" button under "אין תוכנית": staff only. A runner cannot upload the
 * club's plan, and an academy trainee is never sent to /dashboard/plan/new — their plan is
 * their coach's to write.
 */
export function planUploadCta(input: { dayState: HomeDayState; isStaff: boolean; isAcademy: boolean }): boolean {
  return input.dayState === 'noPlan' && input.isStaff && !input.isAcademy;
}

/** From this hour (Israel) the card talks about tomorrow — dashboard/page.tsx's rule. */
export const EVENING_LOOKAHEAD_HOUR = 20;

// ── The workout card ─────────────────────────────────────────────────────────────────────

export interface TodayCard {
  date: string;
  dayOfWeek: number;
  /** "5 × 1 ק״מ", the book's name for the structure (week-board's `structureName`). */
  title: string;
  /** Metres and seconds, estimated like the book's totals ("כ־51 דק׳"). */
  distanceM: number | null;
  durationSec: number | null;
  /** The work pace, sec/km: the reps' when there are reps, else the main run's. */
  paceSec: number | null;
  /** "החזרות ב־4:05" vs "ב־6:10". */
  paceOf: 'reps' | 'run';
  /** quality = the main step is tempo or faster; easy otherwise. */
  kind: Exclude<DayKind, 'rest'>;
  bar: BarSegment[];
  note: string | null;
  onWatch: boolean;
  /** ⚡ planned, at the threshold valid that day. Null without a test. */
  expectedLoad: number | null;
  /** Today's run is in. */
  done: boolean;
}

/**
 * One planned workout as the home's card. `referenceSec` is the threshold the stored paces
 * were written for and `drawAtSec` the one to draw them at — the same pair week-board uses,
 * so the card and the board name and size the session identically.
 */
export function todayCard(
  workout: Pick<ParsedWorkout, 'dayOfWeek' | 'name' | 'steps' | 'description'>,
  ctx: {
    date: string; referenceSec: number; drawAtSec: number; onWatch: boolean; expectedLoad: number | null; done: boolean;
    /** The session's size from the ⚡'s own legs (load.ts `plannedTotals`); else the book's totals. */
    totals?: { distanceM: number; durationSec: number } | null;
  },
): TodayCard {
  const steps = workout.steps ?? [];
  const model: BookStep[] | null = steps.length ? fromLibrarySteps(absoluteToLibrary(steps, ctx.referenceSec).steps) : null;
  let paceSec: number | null = null;
  let paceOf: TodayCard['paceOf'] = 'run';
  let kind: TodayCard['kind'] = 'easy';
  let totals: { distanceM: number; durationSec: number } | null = null;
  if (model) {
    const main = model[mainStepIndex(model)];
    const effort = main && (main.kind === 'reps' || main.kind === 'run') ? main.effort : null;
    if (effort) {
      paceSec = Math.round(effortPace(effort, ctx.drawAtSec));
      const tone = toneOf(effort);
      kind = tone === 'e' ? 'easy' : 'quality';
      paceOf = main.kind === 'reps' && tone !== 'e' ? 'reps' : 'run';
    }
    const t = bookTotals(model, ctx.drawAtSec);
    totals = { distanceM: t.distanceM, durationSec: t.durationSec };
  }
  if (ctx.totals) totals = ctx.totals;
  return {
    date: ctx.date,
    dayOfWeek: workout.dayOfWeek,
    title: model ? structureName(model) : workout.name,
    distanceM: totals && totals.distanceM > 0 ? totals.distanceM : null,
    durationSec: totals && totals.durationSec > 0 ? totals.durationSec : null,
    paceSec,
    paceOf,
    kind,
    bar: model ? profileBar(model, ctx.drawAtSec) : [],
    note: workout.description?.trim() || null,
    onWatch: ctx.onWatch,
    expectedLoad: ctx.expectedLoad != null && ctx.expectedLoad > 0 ? Math.round(ctx.expectedLoad) : null,
    done: ctx.done,
  };
}

/**
 * The session a day is about: the first prescribed part (a double day's verdict follows
 * the plan's main session, build plan §0.10), never an optional one.
 */
export function mainWorkoutOf<T extends Pick<ParsedWorkout, 'optional' | 'partKind'>>(workouts: T[]): T | null {
  const prescribed = workouts.filter(w => !w.optional);
  return prescribed.find(w => w.partKind === 'main' || w.partKind === 'single' || !w.partKind) ?? prescribed[0] ?? null;
}

// ── The invitation ───────────────────────────────────────────────────────────────────────

/** "The test is close": the invitation takes the top slot this many days ahead. */
export const INVITE_SOON_DAYS = 3;

export interface TodayInvitation {
  /** ISO instant of the slot asked for (or the confirmed one). */
  slot: string;
  status: TestInvitation['status'];
}

/**
 * The invitation earns the top of the home only when it is the next thing that matters:
 * the trainee has no usable test yet (their paces depend on it), or the test is at most
 * three days away. Otherwise it waits on the progress tab (7ג). `slotDate` is the slot's
 * Israel date.
 */
export function showInvitation(input: { invitation: TestInvitation | null; slotDate: string | null; hasUsableTest: boolean; today: string }): boolean {
  if (!input.invitation || !input.slotDate) return false;
  if (!input.hasUsableTest) return true;
  return input.slotDate <= shiftDate(input.today, INVITE_SOON_DAYS);
}

/** The slot the card names: the confirmed one, else the first offered. */
export function invitationSlot(inv: Pick<TestInvitation, 'confirmedSlot' | 'proposedSlots'>): string | null {
  return inv.confirmedSlot || inv.proposedSlots[0] || null;
}

// ── The form card ────────────────────────────────────────────────────────────────────────

export type TodayForm =
  | { status: 'ok'; value: number; band: FormBandKey; sentenceKey: string }
  | { status: 'learning'; daysSeen: number; daysLeft: number }
  | { status: 'insufficient' };

/**
 * The number, the word and the sentence (mockup 1/1ב), or the honest "still learning you"
 * (1ג). The sentence follows the band, what the focus day is, and whether last week was
 * heavy ("אחרי שבוע עמוס, עייף במידה").
 *
 * `asOf` is the day the card speaks for. The card titled "איך אתה מגיע למחר" (a rest day,
 * or any evening) is TOMORROW's form: F − A as of tonight, today's real load included (0
 * on a rest day) — mockup 1 → 1ב: −9 on Tuesday is −10 under "למחר" on Wednesday's rest.
 * `focus` picks the sentence said about tomorrow.
 */
export function todayForm(input: {
  rows: LoadRow[]; tests: TestPoint[]; today: string; day: DayKind; asOf?: string; focus?: 'today' | 'tomorrow';
}): TodayForm {
  const asOf = input.asOf ?? input.today;
  const payload = buildLoadPayload({ rows: input.rows, tests: input.tests, today: asOf, range: '6w' });
  const status: LoadStatus = payload.status;
  if (status.kind === 'learning') return { status: 'learning', daysSeen: status.daysSeen, daysLeft: status.daysLeft };
  if (status.kind === 'insufficient' || !payload.today) return { status: 'insufficient' };
  // Last COMPLETE week against the four before it. `weekly` ends with this week.
  const done = payload.weekly.map(w => w.done);
  const lastWeek = done.length >= 2 ? done[done.length - 2] : 0;
  const prev4 = done.slice(Math.max(0, done.length - 6), Math.max(0, done.length - 2));
  const band = formBand(payload.today.form).key;
  return {
    status: 'ok',
    value: payload.today.form,
    band,
    sentenceKey: formSentenceKey({ band, heavyLastWeek: isHeavyWeek(lastWeek, prev4), day: input.day, focus: input.focus }),
  };
}

// ── The body chips ───────────────────────────────────────────────────────────────────────

export interface BodyChip {
  /** Seconds of sleep / bpm, of the newest stored night. */
  value: number;
  /** That night's date: "הבוקר" only when it is today's (build plan risk 3c). */
  date: string;
  verdict: SleepVerdict | RhrVerdict | null;
  range: { lo: number; hi: number } | null;
  /** Nights still needed before there is a range. */
  learning: number | null;
}

function chip(nights: WellnessNight[], today: string, field: RangeField): BodyChip | null {
  const latest = [...nights]
    .filter(n => n.date <= today && Number(n[field]) > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!latest) return null;
  const value = Number(latest[field]);
  // The range is the 30 days before the night shown, so today's own value never widens it.
  const range = normalRange(nights, latest.date, field);
  if (isLearning(range)) return { value, date: latest.date, verdict: null, range: null, learning: range.learning };
  const verdict = field === 'sleep_seconds' ? sleepVerdict(value, range) : rhrVerdict(value, range);
  return { value, date: latest.date, verdict, range: { lo: Math.round(range.lo), hi: Math.round(range.hi) }, learning: null };
}

/** Sleep and resting HR against the trainee's own range; a night older than 3 days is not shown. */
export function bodyChips(nights: WellnessNight[], today: string): { sleep: BodyChip | null; rhr: BodyChip | null } {
  const fresh = (c: BodyChip | null) => (c && c.date >= shiftDate(today, -3) ? c : null);
  return { sleep: fresh(chip(nights, today, 'sleep_seconds')), rhr: fresh(chip(nights, today, 'resting_hr')) };
}

// ── The race line ────────────────────────────────────────────────────────────────────────

export interface TodayRace {
  name: string;
  date: string;
  daysLeft: number;
  /** The band's goal ("3:15"), when it states one. */
  goal: string | null;
  /** "כ־8 שבועות של בנייה". */
  weeksOfBuild: number;
}

export function todayRace(input: {
  goal: { title: string; daysLeft: number | null } | null;
  raceName: string | null;
  raceDate: string | null;
  bandGoal: string | null;
}): TodayRace | null {
  if (!input.goal || !input.raceName || !input.raceDate || input.goal.daysLeft == null) return null;
  return {
    name: input.goal.title,
    date: input.raceDate,
    daysLeft: input.goal.daysLeft,
    goal: input.bandGoal,
    weeksOfBuild: Math.floor(input.goal.daysLeft / 7),
  };
}

// ── Yesterday (1ג) ───────────────────────────────────────────────────────────────────────

export interface TodayYesterday {
  activityId: string;
  /** The planned session's name when yesterday had one ("קל 5 ק״מ"), else null. */
  title: string | null;
  km: number;
  load: number;
  source: LoadSource;
}

/**
 * Yesterday's run with its ⚡, for the trainee whose numbers are still being learned (1ג):
 * the one place they see that their runs ARE being counted, and how ("הערכה לפי דופק").
 * The longest priced run of the day carries the row; the load is the day's sum.
 */
export function todayYesterday(input: {
  rows: Array<LoadRow & { activityId: string }>;
  distances: Record<string, number>;
  today: string;
  title: string | null;
}): TodayYesterday | null {
  const y = shiftDate(input.today, -1);
  const priced = input.rows.filter(r => r.date === y && r.load != null && r.source !== 'not_run' && r.source !== 'none');
  if (!priced.length) return null;
  const main = [...priced].sort((a, b) => (input.distances[b.activityId] ?? 0) - (input.distances[a.activityId] ?? 0))[0];
  return {
    activityId: main.activityId,
    title: input.title,
    km: Math.round((input.distances[main.activityId] ?? 0) / 100) / 10,
    load: Math.round(priced.reduce((s, r) => s + (r.load ?? 0), 0)),
    source: main.source,
  };
}

// ── The payload ──────────────────────────────────────────────────────────────────────────

export interface TraineeToday {
  isMember: boolean;
  dayState: HomeDayState;
  /** Which day the card is about: tomorrow from 20:00 Israel. */
  focus: 'today' | 'tomorrow';
  /** The focus day, YYYY-MM-DD. */
  date: string;
  /** The focus day's session (workout state). */
  card: TodayCard | null;
  /** The day after the focus day, for the rest day's mini card. */
  next: TodayCard | null;
  /** What the day before the focus day was — the rest card's "הגוף בונה עכשיו את החזרות של אתמול". */
  prevKind: TodayCard['kind'] | null;
  athlete: { id: string; name: string; gender: 'male' | 'female' | null };
  coach: { id: string; name: string; avatarUrl: string | null } | null;
  unread: number;
  paceUpdate: PaceUpdateCard | null;
  invitation: TodayInvitation | null;
  form: TodayForm;
  body: { sleep: BodyChip | null; rhr: BodyChip | null };
  race: TodayRace | null;
  /** Only while the numbers are being learned (1ג). */
  yesterday: TodayYesterday | null;
  /** Plan weeks the overlay opens (the focus day's and the next day's). */
  weekStart: string;
}

/** The pieces the route resolved, each already this trainee's own. */
export interface TodayInput {
  today: string;
  evening: boolean;
  /** Cards by date for the days around today (only days with a session). */
  cards: Record<string, TodayCard>;
  /** Whether a plan row exists for the plan week of each date asked. */
  planWeeks: Record<string, boolean>;
  weekStartOf: (date: string) => string;
  athlete: TraineeToday['athlete'];
  coach: TraineeToday['coach'];
  unread: number;
  paceUpdate: PaceUpdateCard | null;
  invitation: TestInvitation | null;
  invitationDate: string | null;
  hasUsableTest: boolean;
  loads: Array<LoadRow & { activityId: string }>;
  tests: TestPoint[];
  nights: WellnessNight[];
  race: TodayRace | null;
  yesterdayTitle: string | null;
  distances: Record<string, number>;
}

/** Everything the home draws, decided. */
export function buildTraineeToday(input: TodayInput): TraineeToday {
  const { today } = input;
  // After 20:00 the day is over whether or not it was run, and the home is about tomorrow:
  // tomorrow's session, or tomorrow's rest with the day after it under it.
  const tomorrow = shiftDate(today, 1);
  const focus: TraineeToday['focus'] = input.evening ? 'tomorrow' : 'today';
  const date = focus === 'tomorrow' ? tomorrow : today;
  const after = shiftDate(date, 1);
  const card = input.cards[date] ?? null;
  const nextCard = input.cards[after] ?? null;
  const dayState = homeDayState({
    hasPlan: !!input.planWeeks[input.weekStartOf(date)],
    today: card,
    tomorrow: nextCard,
    isAcademy: true,
  });
  const day: DayKind = dayState === 'workout' && card ? card.kind : 'rest';
  // The form card speaks for the day the home titles it with: tomorrow on a rest day and
  // every evening (TraineeToday's "איך אתה מגיע למחר"), today otherwise.
  const formAsOf = focus === 'tomorrow' || dayState === 'rest' ? tomorrow : today;
  const form = todayForm({ rows: input.loads, tests: input.tests, today, day, asOf: formAsOf, focus });
  const invite = showInvitation({ invitation: input.invitation, slotDate: input.invitationDate, hasUsableTest: input.hasUsableTest, today })
    ? { slot: invitationSlot(input.invitation!)!, status: input.invitation!.status }
    : null;
  return {
    isMember: true,
    dayState,
    focus,
    date,
    card: dayState === 'workout' ? card : null,
    next: dayState === 'rest' ? nextCard : null,
    prevKind: input.cards[shiftDate(date, -1)]?.kind ?? null,
    athlete: input.athlete,
    coach: input.coach,
    unread: input.unread,
    paceUpdate: input.paceUpdate,
    invitation: invite,
    form,
    body: bodyChips(input.nights, today),
    race: input.race,
    yesterday: form.status === 'ok' ? null : todayYesterday({ rows: input.loads, distances: input.distances, today, title: input.yesterdayTitle }),
    weekStart: input.weekStartOf(date),
  };
}
