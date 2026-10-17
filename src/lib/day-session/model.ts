/**
 * "אימון ליום אחד" — one club session for one date, typed by the coach when there is no
 * weekly plan yet (mockup manual-day-workout). Pure: the gate, the input check, when the
 * feed card shows, the plan-wins rule, the two plan links and the push's once-only rule.
 * The storage is migration 150 (`day_sessions`), the reads and writes are
 * app/api/day-session.
 */

import { hasRole } from '@/lib/auth/roles';
import type { WorkoutStep } from '@/lib/ai/types';
import { DAY_SESSION_FOR_ALL } from './flag';
import {
  isQuickShape, parseClubText, quickToWorkout, validateWorkoutSteps, workoutTitle, workoutTotals, type PackPaces,
} from './workout';
import type { QuickStep } from '@/lib/academy/quick-text';

export type NutritionWhen = 'before' | 'during' | 'after';
export const NUTRITION_WHENS: NutritionWhen[] = ['before', 'during', 'after'];

export interface NutritionLine { when: NutritionWhen; text: string }

export interface DaySession {
  id: string;
  date: string;
  /** 'HH:MM', or null when the coach left it out. */
  startTime: string | null;
  place: string | null;
  title: string;
  /** The coach's original sentence, for reference. '' when the steps were entered by hand. */
  quickText: string;
  /**
   * What is stored and shown, in the planner's shape (lib/day-session/workout.ts): the
   * parse, or the coach's edit of it in the planner's editor (never re-parsed). Every step
   * carries its own pace per pack.
   */
  steps: WorkoutStep[];
  /** "הערות לאימון", free text (migration 151; null before it is pasted). */
  description: string | null;
  nutrition: NutritionLine[];
  publishedAt: string | null;
  notify: boolean;
  notifiedAt: string | null;
  updatedAt: string | null;
  /** The coach's name, for the nutrition sheet's "מ־… · עודכן …". */
  byName?: string | null;
}

// ── The gate ───────────────────────────────────────────────────────────────────────────

export interface Caller {
  isSuperUser: boolean;
  role?: string | null;
  roles?: string[] | null;
}

/** Who may open the form and write. Off: the super user. On: coaches and admins too. */
export function mayEditDaySession(caller: Caller | null | undefined, forAll = DAY_SESSION_FOR_ALL): boolean {
  if (!caller) return false;
  if (caller.isSuperUser) return true;
  return forAll && (hasRole(caller, 'admin') || hasRole(caller, 'coach'));
}

/** Who sees the feed card. Off: the super user. On: every member who can open the feed. */
export function maySeeDaySession(caller: Caller | null | undefined, forAll = DAY_SESSION_FOR_ALL): boolean {
  if (!caller) return false;
  return caller.isSuperUser || forAll;
}

// ── The input ──────────────────────────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_NUTRITION_LINES = 12;

export const MAX_TITLE = 80;
export const MAX_DESCRIPTION = 1000;

export interface DaySessionInput {
  date: string;
  startTime: string | null;
  place: string | null;
  quickText: string;
  /** Explicit steps (the planner editor's): stored as sent, the text is not re-parsed. Null = parse the text. */
  steps: WorkoutStep[] | null;
  /** The coach's own title. Null = the one the structure names. */
  title: string | null;
  description: string | null;
  nutrition: NutritionLine[];
  publish: boolean;
  notify: boolean;
}

const pace = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 120 && n <= 900 ? Math.round(n) : null;
};

/** The request body, checked. A string is the error to answer 400 with. */
export function readInput(body: unknown): DaySessionInput | string {
  const b = (body || {}) as Record<string, unknown>;
  const date = typeof b.date === 'string' ? b.date : '';
  if (!DATE.test(date)) return 'date must be YYYY-MM-DD';
  const time = typeof b.startTime === 'string' ? b.startTime.trim() : '';
  if (time && !TIME.test(time)) return 'startTime must be HH:MM';
  const place = typeof b.place === 'string' ? b.place.trim().slice(0, 120) : '';
  const quickText = typeof b.quickText === 'string' ? b.quickText.trim().slice(0, 500) : '';
  let steps: WorkoutStep[] | null = null;
  if (b.steps !== undefined && b.steps !== null) {
    const checked = validateWorkoutSteps(b.steps);
    if (typeof checked === 'string') return checked;
    steps = checked;
  }
  if (!steps && !quickText) return 'quickText required';
  const title = typeof b.title === 'string' ? b.title.trim().slice(0, MAX_TITLE) : '';
  const description = typeof b.description === 'string' ? b.description.trim().slice(0, MAX_DESCRIPTION) : '';
  const nutrition: NutritionLine[] = (Array.isArray(b.nutrition) ? b.nutrition : [])
    .map((l) => {
      const line = (l || {}) as Record<string, unknown>;
      const when = NUTRITION_WHENS.includes(line.when as NutritionWhen) ? (line.when as NutritionWhen) : null;
      const text = typeof line.text === 'string' ? line.text.trim().slice(0, 200) : '';
      return when && text ? { when, text } : null;
    })
    .filter((l): l is NutritionLine => !!l)
    .slice(0, MAX_NUTRITION_LINES);
  return {
    date,
    startTime: time || null,
    place: place || null,
    quickText,
    steps,
    title: title || null,
    description: description || null,
    nutrition,
    publish: b.publish !== false,
    notify: b.notify !== false,
  };
}

// ── The workout ────────────────────────────────────────────────────────────────────────

/** The text → what is stored: the parse in the planner's shape, and the title the card shows big. */
export function parseWorkout(quickText: string): { steps: WorkoutStep[]; title: string; unknown: string[] } {
  const parse = parseClubText(quickText);
  return { steps: parse.steps, title: parse.steps.length ? workoutTitle(parse.steps) : '', unknown: parse.unknown };
}

/**
 * What the row stores: the editor's steps as sent when there are any (never re-parsed — the
 * edit is the workout), else the parse of the sentence. The title is the coach's when he
 * wrote one, else the session's headline.
 */
export function resolveWorkout(input: Pick<DaySessionInput, 'quickText' | 'steps' | 'title'>): { steps: WorkoutStep[]; title: string } {
  if (input.steps) return { steps: input.steps, title: input.title || workoutTitle(input.steps) };
  const parsed = parseWorkout(input.quickText);
  return { steps: parsed.steps, title: parsed.steps.length ? input.title || parsed.title : '' };
}

export function totalsOf(steps: WorkoutStep[]): { distanceM: number; durationSec: number } {
  return workoutTotals(steps);
}

// ── When the card shows ────────────────────────────────────────────────────────────────

const minutesOf = (hhmm: string | null): number | null => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

/** After the session it stays an hour, then goes. A session with no time lasts the day. */
export const AFTER_MINUTES = 60;

/**
 * From the moment it is published until after the workout: tomorrow's all day, today's
 * until start + its own length + an hour. Anything further out, or already over, is not on
 * the feed. `nowMinutes` is Israel's wall clock (israelNow).
 */
export function isOnFeed(
  s: Pick<DaySession, 'date' | 'startTime' | 'publishedAt' | 'steps'>,
  today: string,
  tomorrow: string,
  nowMinutes: number,
): boolean {
  if (!s.publishedAt) return false;
  if (s.date === tomorrow) return true;
  if (s.date !== today) return false;
  const start = minutesOf(s.startTime);
  if (start === null) return true;
  const length = Math.max(Math.round(totalsOf(s.steps).durationSec / 60), 60);
  return nowMinutes < start + length + AFTER_MINUTES;
}

// ── The weekly plan wins ───────────────────────────────────────────────────────────────

export interface WeekPlanLike {
  hasPlan: boolean;
  sessions?: Array<{ dayOfWeek: number; kmMax: number }>;
  trainingDays?: number;
  weekTotalMin?: number;
  weekTotalMax?: number;
}

/** Does the week's plan already hold a run on that day? Then the plan's card shows, not this. */
export function planCoversDay(plan: WeekPlanLike | null | undefined, dayOfWeek: number): boolean {
  return !!plan?.hasPlan && !!plan.sessions?.some((s) => s.dayOfWeek === dayOfWeek && s.kmMax > 0);
}

// ── The two links ──────────────────────────────────────────────────────────────────────

export interface ProgramWeekLike {
  week_start_date: string;
  training_pdf_url: string | null;
  nutrition_pdf_url: string | null;
}

export interface PlanLinks {
  /** Null = greyed "עוד אין", not tappable. */
  weekly: { href: string; sessions: number; km: number } | null;
  nutrition: { href: string } | null;
}

/**
 * Whether the week holds a weekly plan (a parsed one, or the uploaded sheet) and a
 * nutrition plan (the uploaded sheet — that is the only nutrition plan the club has), and
 * where each link goes.
 */
export function planLinks(weekStart: string, plan: WeekPlanLike | null | undefined, weeks: ProgramWeekLike[] | null | undefined): PlanLinks {
  const row = (weeks || []).find((w) => w.week_start_date === weekStart);
  const hasWeekly = !!plan?.hasPlan || !!row?.training_pdf_url;
  const km = plan?.hasPlan ? Math.round(((plan.weekTotalMin ?? 0) + (plan.weekTotalMax ?? 0)) / 2) : 0;
  return {
    weekly: hasWeekly ? { href: `/dashboard/program?week=${weekStart}`, sessions: plan?.hasPlan ? plan.trainingDays ?? 0 : 0, km } : null,
    nutrition: row?.nutrition_pdf_url ? { href: `/dashboard/program?week=${weekStart}&view=nutrition` } : null,
  };
}

// ── The push, once ─────────────────────────────────────────────────────────────────────

/** Publish with the switch on, and never pushed before. */
export function shouldNotify(s: Pick<DaySession, 'publishedAt' | 'notify' | 'notifiedAt'>): boolean {
  return !!s.publishedAt && s.notify && !s.notifiedAt;
}

/**
 * Send the push at most once per session. `claim` is the conditional write
 * (`notified_at = now() WHERE notified_at IS NULL`) and answers whether THIS call won it;
 * only the winner sends, so two taps on "לפרסם", a retry or a re-publish after an edit
 * never push twice.
 */
export async function notifyOnce(
  s: Pick<DaySession, 'publishedAt' | 'notify' | 'notifiedAt'>,
  deps: { claim: () => Promise<boolean>; send: () => Promise<number> },
): Promise<{ sent: boolean; count: number }> {
  if (!shouldNotify(s)) return { sent: false, count: 0 };
  if (!(await deps.claim())) return { sent: false, count: 0 };
  return { sent: true, count: await deps.send() };
}

function stepsOfRow(raw: unknown, packPaces: PackPaces): WorkoutStep[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  return isQuickShape(raw) ? quickToWorkout(raw as QuickStep[], packPaces) : (raw as WorkoutStep[]);
}

/** Rows as the table stores them → the shape the screens use. */
export function fromRow(r: Record<string, unknown>): DaySession {
  const paces = Array.isArray(r.pack_paces) ? r.pack_paces : [];
  const time = typeof r.start_time === 'string' ? r.start_time.slice(0, 5) : null;
  return {
    id: String(r.id),
    date: String(r.session_date),
    startTime: time,
    place: (r.place as string) || null,
    title: (r.title as string) || '',
    quickText: (r.quick_text as string) || '',
    // A row saved before the planner shape: its quick steps and one rep pace per pack.
    steps: stepsOfRow(r.steps, [pace(paces[0]), pace(paces[1]), pace(paces[2])]),
    description: typeof r.description === 'string' && r.description ? r.description : null,
    nutrition: (Array.isArray(r.nutrition) ? r.nutrition : []) as NutritionLine[],
    publishedAt: (r.published_at as string) || null,
    notify: r.notify !== false,
    notifiedAt: (r.notified_at as string) || null,
    updatedAt: (r.updated_at as string) || null,
  };
}

// ── The pace fields ────────────────────────────────────────────────────────────────────

/** What a coach types into a pack's pace: `3:55`, `355`, `3.55` → 235 sec/km. Null if not a pace. */
export function parsePaceText(text: string): number | null {
  const t = text.trim().replace(/[.,]/, ':');
  if (!t) return null;
  let m: number, s: number;
  if (t.includes(':')) {
    const [a, b] = t.split(':');
    if (!/^\d{1,2}$/.test(a) || !/^\d{1,2}$/.test(b)) return null;
    m = Number(a); s = Number(b.length === 1 ? `${b}0` : b);
  } else if (/^\d{3,4}$/.test(t)) {
    m = Number(t.slice(0, -2)); s = Number(t.slice(-2));
  } else return null;
  if (s >= 60) return null;
  return pace(m * 60 + s);
}

/**
 * A title cut into its number runs and the words between them: `6 × 1 ק״מ` →
 * [`6 × 1`, ` ק״מ`]. The runs go in an LTR isolate so RTL text cannot turn `6 × 1` into
 * `1 × 6`; the Hebrew unit stays outside it, where the reader expects it.
 */
export function numberRuns(text: string): Array<{ ltr: boolean; text: string }> {
  const out: Array<{ ltr: boolean; text: string }> = [];
  const re = /\d[\d.:]*(?:\s*[×x–-]\s*\d[\d.:]*)*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ ltr: false, text: text.slice(last, m.index) });
    out.push({ ltr: true, text: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ ltr: false, text: text.slice(last) });
  return out;
}

/** The same, for a push line: the runs between U+2066 (LRI) and U+2069 (PDI). */
export function isolateNumbers(text: string): string {
  return numberRuns(text).map((r) => (r.ltr ? `⁦${r.text}⁩` : r.text)).join('');
}
