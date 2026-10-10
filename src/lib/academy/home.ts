// The academy home's numbers (mockup academy-manager-v5.html, phone 1). Pure:
// /api/academy/home reads the rows, the client fetches the rest, this counts.
//
//   growth    trainees per plan week, with who joined and who left that week
//   month     joined / left this calendar month
//   today     the tests booked for today
//   squares   this week: on plan · behind · didn't run
//   waiting   "מחכה לך", one row per kind of work, most urgent first

import type { AcademySection } from './areas';

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ── Growth ──────────────────────────────────────────────────────────────────

export interface GrowthWeek {
  /** The plan week's Sunday. */
  weekStart: string;
  /** In the academy at the end of the week. */
  trainees: number;
  /** Of those, already there before the week began. */
  existing: number;
  /** Joined during the week (and still there at its end, or left later). */
  joined: number;
  /** Left during the week. */
  left: number;
}

export interface GrowthPerson {
  /** YYYY-MM-DD, or null when unknown (before migration 077 stamped one). */
  joinedOn: string | null;
  /** YYYY-MM-DD; null for somebody still in the academy. */
  leftOn?: string | null;
}

/**
 * Trainees week by week, counting both today's members and those who left.
 *
 * Someone who left is in every week between their join date and the week they
 * left, so the bars show leaving and not only joining (the trends chart, which
 * reads today's members only, could not). A member with no join date counts
 * from the start; a leaver with no known leaving day is left out of every week,
 * because placing them anywhere would be a guess.
 */
export function buildGrowth({ weeks, current, left }: {
  weeks: string[];
  current: GrowthPerson[];
  left: GrowthPerson[];
}): GrowthWeek[] {
  const datedLeft = left.filter((p) => !!p.leftOn);
  return weeks.map((weekStart) => {
    const end = addDays(weekStart, 6);
    const inAt = (p: GrowthPerson) => !p.joinedOn || p.joinedOn <= end;
    const joinedIn = (p: GrowthPerson) => !!p.joinedOn && p.joinedOn >= weekStart && p.joinedOn <= end;
    const stillIn = [...current.filter(inAt), ...datedLeft.filter((p) => inAt(p) && (p.leftOn as string) > end)];
    const joined = stillIn.filter(joinedIn).length;
    return {
      weekStart,
      trainees: stillIn.length,
      existing: stillIn.length - joined,
      joined,
      left: datedLeft.filter((p) => (p.leftOn as string) >= weekStart && (p.leftOn as string) <= end).length,
    };
  });
}

/** Joined and left in the calendar month of `today` (YYYY-MM-DD). */
export function monthMoves({ current, left, today }: {
  current: GrowthPerson[];
  left: GrowthPerson[];
  today: string;
}): { joined: number; left: number } {
  const month = today.slice(0, 7);
  const all = [...current, ...left];
  return {
    joined: all.filter((p) => p.joinedOn?.slice(0, 7) === month).length,
    left: left.filter((p) => p.leftOn?.slice(0, 7) === month).length,
  };
}

// ── The endpoint's payload (GET /api/academy/home) ──

export interface AcademyHomeResponse {
  scope: 'academy' | 'coach';
  weeks: GrowthWeek[];
  month: { joined: number; left: number };
  today: { count: number; firstAt: string | null };
  /** Test submissions waiting for a staff approval. */
  approvals: Array<{ athleteId: string; name: string; submittedAt: string | null }>;
  /** The funnel, manager only: null for a coach. */
  funnel: {
    live: number;
    forms: Array<{ id: string; name: string; since: string }>;
    stuck: Array<{ id: string; name: string; since: string; waiting: string; days: number }>;
  } | null;
  coachCapacity: number;
}

// ── Today ───────────────────────────────────────────────────────────────────

const ISRAEL_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
const ISRAEL_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false });

/** The Israel calendar day of an instant, YYYY-MM-DD. */
export function israelDayOf(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? ISRAEL_DAY.format(new Date(t)) : null;
}

/** "18:00" on the Israel wall clock. */
export function israelTimeOf(iso: string): string {
  return ISRAEL_TIME.format(new Date(iso));
}

/** Confirmed test invitations whose slot is on `today` (Israel), and the earliest one. */
export function todayTests(
  invites: Array<{ status: string | null; confirmedSlot: string | null }>,
  today: string,
): { count: number; firstAt: string | null } {
  const slots = invites
    .filter((i) => i.status === 'confirmed' && !!i.confirmedSlot && israelDayOf(i.confirmedSlot) === today)
    .map((i) => i.confirmedSlot as string)
    .sort();
  return { count: slots.length, firstAt: slots[0] ?? null };
}

/** "היום: 2 טסטים · הראשון 07:00" / "היום: טסט אחד · 18:00", or null when nothing is booked. */
export function todayLine(today: { count: number; firstAt: string | null } | null | undefined): string | null {
  if (!today || today.count === 0) return null;
  const what = today.count === 1 ? 'טסט אחד' : `${today.count} טסטים`;
  if (!today.firstAt) return `היום: ${what}`;
  return `היום: ${what} · ${today.count === 1 ? '' : 'הראשון '}${israelTimeOf(today.firstAt)}`;
}

// ── This week, three squares ────────────────────────────────────────────────

export interface SquareMember {
  athleteId: string;
  name: string;
  approved: boolean;
  weekRuns: number;
  plannedCount: number;
  completedCount: number;
  completionRate: number | null;
  attention: string[];
}

/**
 * Every approved trainee lands in exactly one square:
 *
 *   didn't run   no run at all this week
 *   behind       ran, but flagged for low adherence (under half the plan)
 *   on plan      everybody else who ran
 *
 * "Behind" reads the same flag the members list and the member sheet show, so a
 * name in the orange square wears the same badge when it is opened.
 */
export function weekSquares<M extends SquareMember>(members: M[]): { onPlan: M[]; behind: M[]; notRun: M[] } {
  const approved = members.filter((m) => m.approved);
  const notRun = approved.filter((m) => m.weekRuns === 0);
  const ran = approved.filter((m) => m.weekRuns > 0);
  const behind = ran.filter((m) => m.attention.includes('low_adherence'));
  const onPlan = ran.filter((m) => !m.attention.includes('low_adherence'));
  const byName = (a: M, b: M) => a.name.localeCompare(b.name);
  return { onPlan: onPlan.sort(byName), behind: behind.sort(byName), notRun: notRun.sort(byName) };
}

/** "MR · AM · +7" — up to two initials, then the rest as a count. */
export function initialsLine(names: string[], shown = 2): string {
  const ini = (n: string) => n.split(/\s+/).filter(Boolean).map((p) => p[0]).join('').toUpperCase().slice(0, 2) || '?';
  const head = names.slice(0, shown).map(ini);
  const rest = names.length - head.length;
  return [...head, ...(rest > 0 ? [`+${rest}`] : [])].join(' · ');
}

// ── Waiting for you ─────────────────────────────────────────────────────────

export type WaitingKind =
  | 'threads' | 'dispatch' | 'form' | 'registrations' | 'stuck' | 'approvals' | 'results'
  // The coach tools (lib/academy/coach-tools.ts): a pace suggestion, a missed week, next week empty.
  | 'pace' | 'missed' | 'copy';

export interface WaitingTarget {
  section: AcademySection;
  threadId?: string;
  candidateId?: string;
  /** Open the club registrations queue (folded into the candidates). */
  registrations?: boolean;
  /** A coach-tools row: which screen it opens and for whom. */
  tool?: { kind: 'pace' | 'missed' | 'copy'; athleteId?: string };
}

export interface WaitingItem {
  key: string;
  kind: WaitingKind;
  title: string;
  sub: string;
  /** How long the oldest piece of it has waited, in hours. Null = unknown. */
  ageHours: number | null;
  action: string;
  target: WaitingTarget;
}

/**
 * Bands, not weights, as in lib/academy/thread.ts: a person waiting on an answer
 * outranks a watch that missed a workout, which outranks paperwork — however old
 * the paperwork is. Inside a band, the oldest first.
 */
const BAND: Record<WaitingKind, number> = {
  threads: 6, form: 5, dispatch: 4,
  // A decision about a trainee's training, below a watch that missed a workout and above
  // paperwork — in the mockup's order: the pace, the missed week, then the empty week.
  pace: 3.6, missed: 3.5,
  stuck: 3, approvals: 3, copy: 2.5, registrations: 2, results: 1,
};

export interface WaitingInput {
  now: string;
  /** Inbox rows awaiting a reply (lib/academy/thread.ts → reason 'awaiting_reply'). */
  threads?: Array<{ athleteId: string; name: string; waitingHours: number | null }>;
  /** Dispatch rows the coach should act on. */
  dispatch?: Array<{ athleteId: string; name: string; sentAt: string | null }>;
  /** New registration forms — candidates waiting for the intro call. */
  forms?: Array<{ id: string; name: string; since: string }>;
  /** Candidates past their stage's threshold (forms excluded). */
  stuck?: Array<{ id: string; name: string; since: string; waiting: string; days: number }>;
  /** Test submissions waiting for approval. */
  approvals?: Array<{ athleteId: string; name: string; submittedAt: string | null }>;
  registrations?: number;
  results?: number;
  /**
   * The coach-tools rows, already worded by the screen (their copy is in messages/*.json,
   * with every number isolated), so only their place in the list is decided here.
   */
  tools?: Array<Omit<WaitingItem, 'target'> & { target: WaitingTarget }>;
}

const hoursSince = (iso: string | null | undefined, now: number): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, (now - t) / 3_600_000) : null;
};
const firstNames = (names: string[], n = 3) =>
  names.slice(0, n).map((x) => x.trim().split(/\s+/)[0]).join(', ') + (names.length > n ? '…' : '');
const oldest = (hours: Array<number | null>): number | null => {
  const known = hours.filter((h): h is number => h !== null);
  return known.length ? Math.max(...known) : null;
};

export function buildWaiting(input: WaitingInput): WaitingItem[] {
  const now = Date.parse(input.now);
  const out: WaitingItem[] = [];

  const threads = input.threads ?? [];
  if (threads.length) {
    const one = threads.length === 1 ? threads[0] : null;
    out.push({
      key: 'threads', kind: 'threads',
      title: one ? `${one.name} מחכה לתשובה` : `${threads.length} הודעות מחכות`,
      sub: one ? 'הודעה בשיחה' : firstNames(threads.map((t) => t.name)),
      ageHours: oldest(threads.map((t) => t.waitingHours)),
      action: 'לענות',
      target: { section: 'threads', threadId: one?.athleteId },
    });
  }

  const dispatch = input.dispatch ?? [];
  if (dispatch.length) {
    const people = [...new Map(dispatch.map((d) => [d.athleteId, d.name])).values()];
    out.push({
      key: 'dispatch', kind: 'dispatch',
      title: people.length === 1 ? `${people[0]} · לא הגיע לשעון` : `${people.length} לא הגיעו לשעון`,
      sub: people.length === 1 ? 'אימון שלא אושר על השעון' : firstNames(people),
      ageHours: oldest(dispatch.map((d) => hoursSince(d.sentAt, now))),
      action: 'לשעונים',
      target: { section: 'dispatch' },
    });
  }

  for (const f of input.forms ?? []) {
    out.push({
      key: `form:${f.id}`, kind: 'form',
      title: `טופס חדש · ${f.name}`,
      sub: 'השלב הבא: שיחת היכרות',
      ageHours: hoursSince(f.since, now),
      action: 'לקבוע',
      target: { section: 'funnel', candidateId: f.id },
    });
  }

  for (const s of input.stuck ?? []) {
    out.push({
      key: `stuck:${s.id}`, kind: 'stuck',
      title: `תקוע · ${s.name}`,
      sub: s.waiting,
      ageHours: hoursSince(s.since, now),
      action: 'לפתוח',
      target: { section: 'funnel', candidateId: s.id },
    });
  }

  const approvals = input.approvals ?? [];
  if (approvals.length) {
    out.push({
      key: 'approvals', kind: 'approvals',
      title: approvals.length === 1 ? `טסט לאישור · ${approvals[0].name}` : `${approvals.length} טסטים לאישור`,
      sub: approvals.length === 1 ? 'התוצאה מחכה לבדיקה' : firstNames(approvals.map((a) => a.name)),
      ageHours: oldest(approvals.map((a) => hoursSince(a.submittedAt, now))),
      action: 'לבדוק',
      target: { section: 'tests' },
    });
  }

  if (input.registrations) {
    out.push({
      key: 'registrations', kind: 'registrations',
      title: input.registrations === 1 ? 'טופס הצטרפות חדש' : `${input.registrations} טפסי הצטרפות חדשים`,
      sub: 'הרשמה למועדון',
      ageHours: null,
      action: 'לטפל',
      target: { section: 'funnel', registrations: true },
    });
  }

  if (input.results) {
    out.push({
      key: 'results', kind: 'results',
      title: input.results === 1 ? 'תוצאה אחת לאישור' : `${input.results} תוצאות לאישור`,
      sub: 'תוצאות מרוצים ומדידות',
      ageHours: null,
      action: 'לאשר',
      target: { section: 'results' },
    });
  }

  for (const item of input.tools ?? []) out.push(item);

  const score = (w: WaitingItem) => BAND[w.kind] * 1e6 + Math.min(999_999, w.ageHours ?? 0);
  return out.sort((a, b) => score(b) - score(a) || a.key.localeCompare(b.key));
}

/** The age chip: "שעה", "5 ש׳", "יום", "2 ימים". Null below an hour or when unknown. */
export function ageLabel(hours: number | null): string | null {
  if (hours === null || hours < 1) return null;
  if (hours < 24) {
    const h = Math.floor(hours);
    return h === 1 ? 'שעה' : `${h} ש׳`;
  }
  const d = Math.floor(hours / 24);
  return d === 1 ? 'יום' : `${d} ימים`;
}
