import { roundToStep } from '@/lib/notifications/scheduling';
import { shiftDate } from './load';
import type { FormBandKey } from './form-bands';
import type { RhrVerdict, SleepVerdict } from './normal-range';
import type { TodayCard } from './trainee-today';

/**
 * The morning reminder (trainee-experience-v2 screen 9, spec §3.7, TP's daily workout
 * email as a push): on a day with an academy workout, at the time the trainee chose, what
 * they run, at what pace, and whether it is on the watch — plus a third line only when it
 * changes the advice.
 *
 * Pure: the cron tick (morning-reminder-server.ts) reads the rows and asks this module
 * whether to send and what. Lines come back as i18n keys (`trainee.reminder.*`) + params;
 * `reminderCopy` renders them in the recipient's language.
 */

export interface ReminderPref {
  enabled: boolean;
  /** "HH:MM", Israel time, on the 5-minute grid of the cron tick. */
  time: string;
}

export const REMINDER_DEFAULT: ReminderPref = { enabled: true, time: '06:00' };
/** How long after the chosen time a tick may still send it (a missed tick is not a lost day). */
export const REMINDER_WINDOW_MIN = 30;
/** From this hour the reminder previews TOMORROW (TP: an evening email is about tomorrow). */
export const EVENING_FROM_HOUR = 12;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** A valid HH:MM, snapped to the 5-minute grid (`roundToStep`); null for anything else. */
export function normalizeReminderTime(time: unknown): string | null {
  if (typeof time !== 'string' || !HHMM.test(time)) return null;
  // 23:58 would round (and wrap) to 00:00 — the start of the day, not its end.
  if (minutesOf(time) > 23 * 60 + 57) return '23:55';
  return roundToStep(time);
}

/**
 * The saved preference (`athletes.notification_prefs.morningReminder`). Absent means the
 * default — but only once TRAINEE_V2_FOR_ALL is on; before that the reminder is a preview,
 * so only somebody who switched it on explicitly gets it.
 */
export function readReminderPref(prefs: unknown, v2ForAll: boolean): ReminderPref {
  const saved = (prefs && typeof prefs === 'object' ? (prefs as { morningReminder?: unknown }).morningReminder : null) as
    | { enabled?: unknown; time?: unknown }
    | null
    | undefined;
  const time = normalizeReminderTime(saved?.time) ?? REMINDER_DEFAULT.time;
  if (saved && typeof saved.enabled === 'boolean') return { enabled: saved.enabled, time };
  return { enabled: v2ForAll && REMINDER_DEFAULT.enabled, time };
}

/**
 * PATCH /api/athletes/notification-prefs's body, validated. Either or both: `enabled` a
 * boolean, `time` "HH:MM" snapped to the cron tick's 5-minute grid (`roundToStep`). Null
 * for anything else (the route's 400) and for a body that changes nothing.
 */
export function readReminderPatch(body: unknown): { enabled?: boolean; time?: string } | null {
  const raw = (body && typeof body === 'object' ? (body as { morningReminder?: unknown }).morningReminder : null) as
    | { enabled?: unknown; time?: unknown }
    | null
    | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const out: { enabled?: boolean; time?: string } = {};
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') return null;
    out.enabled = raw.enabled;
  }
  if (raw.time !== undefined) {
    const time = normalizeReminderTime(raw.time);
    if (!time) return null;
    out.time = time;
  }
  return out.enabled === undefined && out.time === undefined ? null : out;
}

/** Before 12:00 a reminder is about today's workout; from 12:00, tomorrow's. */
export function targetDateFor(time: string, today: string): string {
  return minutesOf(time) < EVENING_FROM_HOUR * 60 ? today : shiftDate(today, 1);
}

/**
 * Is a tick at `nowMin` (Israel minutes since midnight) inside the send window of `time`?
 * The tick runs on the 5-minute grid, so `nowMin` is floored to it first; the window is
 * [time, time + 30) and does not cross midnight.
 */
export function isDue(nowMin: number, time: string, windowMin = REMINDER_WINDOW_MIN): boolean {
  const now = Math.floor(nowMin / 5) * 5;
  const at = minutesOf(time);
  return now >= at && now < Math.min(at + windowMin, 24 * 60);
}

// ── What it says ───────────────────────────────────────────────────────────────────────

export interface ReminderLine {
  key: string;
  params: Record<string, string | number>;
}

export interface ReminderLines {
  title: ReminderLine;
  /** Line 2, its parts joined with " · ". */
  facts: ReminderLine[];
  /** Line 3, only when it changes the advice. */
  advice: ReminderLine | null;
}

export interface ReminderBody {
  sleep: SleepVerdict | null;
  rhr: RhrVerdict | null;
}

export interface ReminderForm {
  form: number;
  band: FormBandKey;
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const kmText = (m: number) => {
  const v = Math.round(m / 100) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

/** "5 × 1 ק״מ" → 5. Null when the name is not reps. */
export function repCount(title: string): number | null {
  const m = /^\s*(\d+)\s*[×x]/.exec(title);
  return m ? Number(m[1]) : null;
}

/**
 * Line 3 (spec §3.7): a short night or a high resting HR → the "you may lower it" line,
 * which on a reps day names the rep they may stop at; otherwise good form (≥5) → "רעננות
 * טובה". Never a cheer for a trainee who is very tired or whose body says otherwise — and
 * nothing at all when no line would change what they do.
 */
export function adviceLine(input: { body: ReminderBody | null; form: ReminderForm | null; card: Pick<TodayCard, 'title' | 'kind'> }): ReminderLine | null {
  const { body, form, card } = input;
  const rhrHigh = body?.rhr === 'high' || body?.rhr === 'bitHigh';
  const sleepLow = body?.sleep === 'less' || body?.sleep === 'veryLittle';
  if (rhrHigh || sleepLow) {
    const reps = card.kind === 'quality' ? repCount(card.title) : null;
    const which = rhrHigh ? (body?.rhr === 'high' ? 'rhrHigh' : 'rhrBitHigh') : 'sleepLow';
    return reps && reps >= 3
      ? { key: `trainee.reminder.advice.${which}Reps`, params: { n: reps - 1 } }
      : { key: `trainee.reminder.advice.${which}`, params: {} };
  }
  if (form && form.band !== 'veryTired' && Math.round(form.form) >= 5) {
    return { key: `trainee.reminder.advice.${card.kind === 'quality' ? 'freshQuality' : 'fresh'}`, params: {} };
  }
  return null;
}

export function reminderLines(input: {
  card: Pick<TodayCard, 'title' | 'distanceM' | 'durationSec' | 'paceSec' | 'paceOf' | 'kind' | 'onWatch'>;
  when: 'today' | 'tomorrow';
  body: ReminderBody | null;
  form: ReminderForm | null;
}): ReminderLines {
  const { card, when } = input;
  const title: ReminderLine = card.paceSec
    ? { key: 'trainee.reminder.title', params: { when, title: card.title, pace: clock(card.paceSec) } }
    : { key: 'trainee.reminder.titleNoPace', params: { when, title: card.title } };
  const facts: ReminderLine[] = [];
  if (card.distanceM) facts.push({ key: 'trainee.reminder.km', params: { km: kmText(card.distanceM) } });
  if (card.durationSec) facts.push({ key: 'trainee.reminder.min', params: { min: Math.round(card.durationSec / 60) } });
  facts.push({ key: card.onWatch ? 'trainee.reminder.onWatch' : 'trainee.reminder.notOnWatch', params: {} });
  return { title, facts, advice: adviceLine(input) };
}

// ── The decision ───────────────────────────────────────────────────────────────────────

export type SkipReason = 'disabled' | 'notDue' | 'muted' | 'noPlan' | 'noWorkout' | 'sent' | 'alreadyRan';

export type ReminderDecision =
  | { send: true; workoutDate: string; lines: ReminderLines }
  | { send: false; reason: SkipReason };

export interface ReminderInput {
  pref: ReminderPref;
  /** Israel time of the tick, minutes since midnight. */
  nowMin: number;
  today: string;
  /** `isKindMuted('academy_morning', prefs)` — the 'workouts' category. */
  muted: boolean;
  /** The week of the target date has a plan (own row or the group's). */
  hasPlan: boolean;
  /** The target date's main session, or null on a rest day. */
  card: (Pick<TodayCard, 'title' | 'distanceM' | 'durationSec' | 'paceSec' | 'paceOf' | 'kind' | 'onWatch'> & { done?: boolean }) | null;
  /** The ledger already holds this athlete + date. */
  alreadySent: boolean;
  /** A run started today before the send time. */
  ranBeforeSend: boolean;
  body: ReminderBody | null;
  form: ReminderForm | null;
}

/**
 * Send or skip, and why. The order is the cheapest reason first, so the server can stop
 * reading as soon as one holds: switched off, not the time, muted, no plan, a rest day,
 * already sent, already run.
 */
export function decideMorningReminder(input: ReminderInput): ReminderDecision {
  if (!input.pref.enabled) return { send: false, reason: 'disabled' };
  if (!isDue(input.nowMin, input.pref.time)) return { send: false, reason: 'notDue' };
  if (input.muted) return { send: false, reason: 'muted' };
  if (!input.hasPlan) return { send: false, reason: 'noPlan' };
  if (!input.card) return { send: false, reason: 'noWorkout' };
  if (input.alreadySent) return { send: false, reason: 'sent' };
  const workoutDate = targetDateFor(input.pref.time, input.today);
  // Run already (a 05:30 run before a 06:00 reminder): telling them what to run is noise.
  if (workoutDate === input.today && (input.ranBeforeSend || input.card.done)) return { send: false, reason: 'alreadyRan' };
  return {
    send: true,
    workoutDate,
    lines: reminderLines({ card: input.card, when: workoutDate === input.today ? 'today' : 'tomorrow', body: input.body, form: input.form }),
  };
}

/** The ledger's url for one athlete and one workout day: one reminder, however many ticks. */
export function reminderLedgerUrl(athleteId: string, workoutDate: string): string {
  return `#ledger:academy-morning:${athleteId}:${workoutDate}`;
}

/**
 * The push in one language. `t` renders a key with its params, with `<m>…</m>` already
 * turned into a Unicode isolate (a lock screen has no <bdi>, but it honours LRI…PDI, so
 * "5 × 1" and "4:05" keep their order inside the Hebrew sentence).
 */
export function reminderCopy(lines: ReminderLines, t: (key: string, params: Record<string, string | number>) => string): { title: string; body: string } {
  const facts = lines.facts.map(l => t(l.key, l.params)).join(' · ');
  const body = lines.advice ? `${facts}\n${t(lines.advice.key, lines.advice.params)}` : facts;
  return { title: t(lines.title.key, lines.title.params), body };
}

/** LRI … PDI: the push's stand-in for <bdi dir="ltr">. */
export const isolateLtr = (s: string) => `\u2066${s}\u2069`;

/** A number, a pace or a structure inside a name: `5 × 1`, `4:01–4:09`, `10.3`. */
const STRUCTURE = /\d[\d.:,]*(?:\s*[×x–-]\s*\d[\d.:,]*)*/g;

/**
 * A session's name for the lock screen: every number run isolated LTR, the rest left to
 * the paragraph — "5 × 1 ק״מ" keeps "5 × 1" in order with ק״מ after it (trainee/ui.tsx
 * StructureText's rule, in characters instead of <bdi>).
 */
export function isolateNumbers(text: string): string {
  return text.replace(STRUCTURE, m => isolateLtr(m));
}
