/**
 * "אימון ליום אחד" — one club session for one date, typed by the coach when there is no
 * weekly plan yet (mockup manual-day-workout). Pure: the gate, the input check, when the
 * feed card shows, the plan-wins rule, the two plan links and the push's once-only rule.
 * The storage is migration 150 (`day_sessions`), the reads and writes are
 * app/api/day-session.
 */

import { hasRole } from '@/lib/auth/roles';
import { parseQuickText, quickToBook, type QuickEffort, type QuickParse, type QuickStep } from '@/lib/academy/quick-text';
import {
  bookTotals, effortFromPace, isPureZone, effortFromZone, effortPace, ESTIMATE_THRESHOLD_SEC, structureName, TYPED_HALF_WIDTH_PCT,
  type BookStep, type Effort, type Length, type Measure, type RestMode,
} from '@/lib/academy/book-steps';
import { paceFromPct } from '@/lib/academy/library';
import { isDraftZone } from '@/lib/academy/library-draft';
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
  /** The coach's original sentence, for reference. '' when the steps were entered by hand. */
  quickText: string;
  /** What is stored and shown: the parse, or the coach's edit of it (never re-parsed). */
  steps: QuickStep[];
  /** "הערות לאימון", free text (migration 151; null before it is pasted). */
  description: string | null;
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

export const MAX_TITLE = 80;
export const MAX_DESCRIPTION = 1000;

export interface DaySessionInput {
  date: string;
  startTime: string | null;
  place: string | null;
  quickText: string;
  /** Explicit steps (the editor's): stored as sent, the text is not re-parsed. Null = parse the text. */
  steps: QuickStep[] | null;
  /** The coach's own title. Null = the one the structure names. */
  title: string | null;
  description: string | null;
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
  let steps: QuickStep[] | null = null;
  if (b.steps !== undefined && b.steps !== null) {
    const checked = validateSteps(b.steps);
    if (typeof checked === 'string') return checked;
    steps = checked;
  }
  if (!steps && !quickText) return 'quickText required';
  const title = typeof b.title === 'string' ? b.title.trim().slice(0, MAX_TITLE) : '';
  const description = typeof b.description === 'string' ? b.description.trim().slice(0, MAX_DESCRIPTION) : '';
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
    steps,
    title: title || null,
    description: description || null,
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

/**
 * What the row stores: the editor's steps as sent when there are any (never re-parsed — the
 * edit is the workout), else the parse of the sentence. The title is the coach's when he
 * wrote one, else the structure's name.
 */
export function resolveWorkout(input: Pick<DaySessionInput, 'quickText' | 'steps' | 'title'>): { steps: QuickStep[]; title: string } {
  if (input.steps) {
    const book = bookOf(input.steps);
    return { steps: input.steps, title: input.title || (book.length ? structureName(book) : '') };
  }
  const parsed = parseWorkout(input.quickText);
  return { steps: parsed.steps, title: parsed.steps.length ? input.title || parsed.title : '' };
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
    description: typeof r.description === 'string' && r.description ? r.description : null,
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

// ── The editor (the workout book's adjust screen, for a club session) ─────────────────

/**
 * The threshold the editor draws at. A club session has no one trainee, so a pace is held
 * as a share of the book's typical threshold and turned back into the same sec/km on save
 * (bookToQuick). Nothing about anybody's own pace is implied by it.
 */
export const EDIT_THRESHOLD_SEC = ESTIMATE_THRESHOLD_SEC;

function quickEffortOf(effort: Effort | null): QuickEffort | null {
  if (!effort) return null;
  if (isPureZone(effort)) return { kind: 'zone', zone: effort.zone! };
  const T = EDIT_THRESHOLD_SEC;
  const half = (effort.intensity.fastPct - effort.intensity.slowPct) / 2;
  // A single typed pace (the ±1.5% band) goes back to the single number it was.
  if (Math.abs(half - TYPED_HALF_WIDTH_PCT) < 0.3) {
    const c = effortPace(effort, T);
    return { kind: 'pace', min: c, max: c };
  }
  return { kind: 'pace', min: paceFromPct(T, effort.intensity.fastPct), max: paceFromPct(T, effort.intensity.slowPct) };
}

/** The editor's steps → the stored shape. `hr` steps have no place in a club session. */
export function bookToQuick(steps: BookStep[]): QuickStep[] {
  const out: QuickStep[] = [];
  for (const s of steps) {
    if (s.kind === 'rest') out.push({ kind: 'rest', length: { ...s.length }, mode: s.mode });
    else if (s.kind === 'reps') {
      out.push({
        kind: 'reps', count: s.count, work: { ...s.work }, effort: quickEffortOf(s.effort),
        rest: s.rest ? { length: { ...s.rest.length }, mode: s.rest.mode } : null,
      });
    } else if (s.kind === 'run') out.push({ kind: 'run', role: s.role, length: s.length ? { ...s.length } : null, effort: quickEffortOf(s.effort) });
  }
  return out;
}

/** The steps to send: the original parse when the edit changed nothing, else the edit. */
export function stepsToStore(edited: BookStep[], from: QuickStep[] | null): QuickStep[] {
  if (from && JSON.stringify(bookOf(from)) === JSON.stringify(edited)) return from;
  return bookToQuick(edited);
}

export type NewStepKind = 'warmup' | 'reps' | 'run' | 'rest' | 'cooldown';
export const NEW_STEP_KINDS: NewStepKind[] = ['warmup', 'reps', 'run', 'rest', 'cooldown'];

export interface NewStepSpec {
  kind: NewStepKind;
  measure: Measure;
  /** Metres or seconds. */
  value: number;
  /** sec/km; null = an easy run / fast reps, said as a word. */
  pace: number | null;
  count?: number;
  /** The recovery between reps, seconds; null = none. */
  restSec?: number | null;
}

/** What "+ שלב" opens with, per type. */
export function newStepDefaults(kind: NewStepKind): NewStepSpec {
  switch (kind) {
    case 'reps': return { kind, measure: 'distance', value: 1000, pace: null, count: 5, restSec: 120 };
    case 'rest': return { kind, measure: 'time', value: 120, pace: null };
    case 'run': return { kind, measure: 'distance', value: 5000, pace: null };
    default: return { kind, measure: 'distance', value: 2000, pace: null };
  }
}

/** The spec → a book step, with the book's limits. Null = a number out of range. */
export function buildStep(spec: NewStepSpec): BookStep | null {
  const length: Length = { measure: spec.measure, value: Math.round(spec.value) };
  if (!lengthOk(length)) return null;
  if (spec.pace !== null && !(spec.pace >= LIMIT.pace[0] && spec.pace <= LIMIT.pace[1])) return null;
  const effort = (zone: 'easy' | 'interval'): Effort => (spec.pace !== null ? effortFromPace(spec.pace, EDIT_THRESHOLD_SEC) : effortFromZone(zone));
  if (spec.kind === 'rest') return { kind: 'rest', length, mode: null };
  if (spec.kind === 'reps') {
    const count = Math.round(spec.count ?? 0);
    if (!(count >= LIMIT.count[0] && count <= LIMIT.count[1])) return null;
    const rest = spec.restSec ? { length: { measure: 'time' as const, value: Math.round(spec.restSec) }, mode: 'jog' as RestMode } : null;
    if (rest && !lengthOk(rest.length)) return null;
    return { kind: 'reps', count, work: length, effort: effort('interval'), rest };
  }
  return { kind: 'run', role: spec.kind === 'run' ? 'main' : spec.kind, length, effort: effort('easy') };
}

/** A warmup goes after the leading warmups, a cooldown last, anything else before the cooldown. */
export function insertStep(steps: BookStep[], step: BookStep): BookStep[] {
  const next = [...steps];
  const role = step.kind === 'run' ? step.role : null;
  if (role === 'cooldown') { next.push(step); return next; }
  if (role === 'warmup') {
    let i = 0;
    while (i < next.length && next[i].kind === 'run' && (next[i] as { role?: string }).role === 'warmup') i += 1;
    next.splice(i, 0, step);
    return next;
  }
  const cooldown = next.findIndex((s) => s.kind === 'run' && s.role === 'cooldown');
  if (cooldown >= 0) next.splice(cooldown, 0, step);
  else next.push(step);
  return next;
}

/** One place up (`-1`) or down (`1`). Out of range = unchanged. */
export function moveStep(steps: BookStep[], index: number, by: 1 | -1): BookStep[] {
  const to = index + by;
  if (index < 0 || index >= steps.length || to < 0 || to >= steps.length) return steps;
  const next = [...steps];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Distance ⇄ time for a step's length, to the type's default in the other measure. */
export function switchMeasure(steps: BookStep[], index: number): BookStep[] {
  const s = steps[index];
  if (!s || s.kind === 'hr') return steps;
  const flip = (len: Length | null, distance: number, time: number): Length =>
    len?.measure === 'time' ? { measure: 'distance', value: distance } : { measure: 'time', value: time };
  const next = [...steps];
  if (s.kind === 'reps') next[index] = { ...s, work: flip(s.work, 1000, 180) };
  else if (s.kind === 'rest') next[index] = { ...s, length: flip(s.length, 200, 120) };
  else next[index] = { ...s, length: flip(s.length, 2000, 600) };
  return next;
}

/** "3:00" / "3" (minutes) → seconds. Null if neither. */
export function parseClockText(text: string): number | null {
  const t = text.trim().replace(/[.,]/, ':');
  if (/^\d{1,3}$/.test(t)) return Number(t) * 60;
  const m = /^(\d{1,3}):(\d{2})$/.exec(t);
  if (!m || Number(m[2]) >= 60) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// ── Explicit steps, checked (the same limits the book's editor keeps) ─────────────────

export const MAX_STEPS = 30;
const LIMIT = {
  count: [1, 50],
  distance: [100, 60000],
  time: [10, 6 * 3600],
  pace: [150, 900],
} as const;
const ROLES = ['warmup', 'main', 'cooldown'] as const;
const MODES: RestMode[] = ['jog', 'walk', 'stand'];

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function lengthOk(len: Length): boolean {
  const lim = LIMIT[len.measure];
  return !!lim && isInt(len.value) && len.value >= lim[0] && len.value <= lim[1];
}

function readLength(v: unknown): Length | null {
  const l = (v || {}) as Record<string, unknown>;
  if (l.measure !== 'distance' && l.measure !== 'time') return null;
  const len: Length = { measure: l.measure, value: l.value as number };
  return lengthOk(len) ? len : null;
}

function readEffort(v: unknown): QuickEffort | null | false {
  if (v === null || v === undefined) return null;
  const e = v as Record<string, unknown>;
  if (e.kind === 'open') return { kind: 'open' };
  if (e.kind === 'zone') return isDraftZone(e.zone) ? { kind: 'zone', zone: e.zone } : false;
  if (e.kind === 'pace') {
    const ok = (n: unknown) => isInt(n) && n >= LIMIT.pace[0] && n <= LIMIT.pace[1];
    if (!ok(e.min) || !ok(e.max) || (e.min as number) > (e.max as number)) return false;
    return { kind: 'pace', min: e.min as number, max: e.max as number };
  }
  return false;
}

const readMode = (v: unknown): RestMode | null | false => (v === null || v === undefined ? null : MODES.includes(v as RestMode) ? (v as RestMode) : false);

/** The editor's steps from a request body. A string is the 400. */
export function validateSteps(raw: unknown): QuickStep[] | string {
  if (!Array.isArray(raw)) return 'steps must be a list';
  if (!raw.length) return 'steps empty';
  if (raw.length > MAX_STEPS) return `at most ${MAX_STEPS} steps`;
  const out: QuickStep[] = [];
  for (const [i, item] of raw.entries()) {
    const s = (item || {}) as Record<string, unknown>;
    const bad = (what: string) => `step ${i + 1}: ${what}`;
    if (s.kind === 'rest') {
      const length = readLength(s.length);
      if (!length) return bad('rest length out of range');
      const mode = readMode(s.mode);
      if (mode === false) return bad('rest mode');
      out.push({ kind: 'rest', length, mode });
    } else if (s.kind === 'reps') {
      if (!isInt(s.count) || s.count < LIMIT.count[0] || s.count > LIMIT.count[1]) return bad('count out of range');
      const work = readLength(s.work);
      if (!work) return bad('rep length out of range');
      const effort = readEffort(s.effort);
      if (effort === false) return bad('pace');
      let rest: { length: Length; mode: RestMode | null } | null = null;
      if (s.rest !== null && s.rest !== undefined) {
        const r = s.rest as Record<string, unknown>;
        const length = readLength(r.length);
        if (!length) return bad('recovery out of range');
        const mode = readMode(r.mode);
        if (mode === false) return bad('recovery mode');
        rest = { length, mode };
      }
      out.push({ kind: 'reps', count: s.count, work, effort, rest });
    } else if (s.kind === 'run') {
      if (!ROLES.includes(s.role as typeof ROLES[number])) return bad('role');
      let length: Length | null = null;
      if (s.length !== null && s.length !== undefined) {
        length = readLength(s.length);
        if (!length) return bad('length out of range');
      }
      const effort = readEffort(s.effort);
      if (effort === false) return bad('pace');
      out.push({ kind: 'run', role: s.role as typeof ROLES[number], length, effort });
    } else {
      return bad('unknown kind');
    }
  }
  if (!out.some((s) => s.kind !== 'rest')) return 'steps hold no running';
  return out;
}
