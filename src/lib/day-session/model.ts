/**
 * "אימון ליום אחד" — one club session for one date, typed by the coach when there is no
 * weekly plan yet (mockup manual-day-workout). Pure: the gate, the input check, when the
 * feed card shows, the plan-wins rule, the two plan links and the push's once-only rule.
 * The storage is migration 149 (`day_sessions`), the reads and writes are
 * app/api/day-session.
 */

import { hasRole } from '@/lib/auth/roles';
import { parseQuickText, quickToBook, type QuickParse, type QuickStep } from '@/lib/academy/quick-text';
import { bookTotals, ESTIMATE_THRESHOLD_SEC, structureName, type BookStep } from '@/lib/academy/book-steps';
import { DAY_SESSION_FOR_ALL } from './flag';

export type NutritionWhen = 'before' | 'during' | 'after';
export const NUTRITION_WHENS: NutritionWhen[] = ['before', 'during', 'after'];

export interface NutritionLine { when: NutritionWhen; text: string }

/** One pace per pack (sec/km for the reps), pack 1 first. Null = not set. */
export type PackPaces = [number | null, number | null, number | null];

export interface DaySession {
  id: string;
  date: string;
  /** 'HH:MM', or null when the coach left it out. */
  startTime: string | null;
  place: string | null;
  title: string;
  quickText: string;
  steps: QuickStep[];
  packPaces: PackPaces;
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

export interface DaySessionInput {
  date: string;
  startTime: string | null;
  place: string | null;
  quickText: string;
  packPaces: PackPaces;
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
  if (!quickText) return 'quickText required';
  const paces = Array.isArray(b.packPaces) ? b.packPaces : [];
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
    packPaces: [pace(paces[0]), pace(paces[1]), pace(paces[2])],
    nutrition,
    publish: b.publish !== false,
    notify: b.notify !== false,
  };
}

// ── The workout ────────────────────────────────────────────────────────────────────────

/** The parse as quickToBook wants it, from the stored steps. */
const asParse = (steps: QuickStep[]): QuickParse => ({ steps, assumptions: [], unknown: [], kindHint: null });

/**
 * The stored steps as book steps, for the bar and the totals. Drawn at the book's typical
 * threshold: a club session has three packs and no one trainee, and the size of the session
 * is what the bar says, not anybody's pace.
 */
export function bookOf(steps: QuickStep[]): BookStep[] {
  return quickToBook(asParse(steps), ESTIMATE_THRESHOLD_SEC).steps;
}

/** The text → what is stored: the parse, and the title the card shows big. */
export function parseWorkout(quickText: string): { steps: QuickStep[]; title: string } {
  const parse = parseQuickText(quickText);
  const book = quickToBook(parse, ESTIMATE_THRESHOLD_SEC).steps;
  return { steps: parse.steps, title: book.length ? structureName(book) : '' };
}

export function totalsOf(steps: QuickStep[]): { distanceM: number; durationSec: number } {
  const t = bookTotals(bookOf(steps), null);
  return { distanceM: t.distanceM, durationSec: t.durationSec };
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
    steps: (Array.isArray(r.steps) ? r.steps : []) as QuickStep[],
    packPaces: [pace(paces[0]), pace(paces[1]), pace(paces[2])],
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
