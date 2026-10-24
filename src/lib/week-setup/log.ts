import { addDays, type Section } from './model';

/**
 * WHO DID WHAT THIS WEEK (Ofer, 10-24: "it matters that we see who set what — that Yair
 * pushed the plan — and then I know I can go on to the polls; really a flow").
 *
 * Every action the Saturday screen counts is written here by the route that did it, with
 * the person from the session: the plan uploaded, sent to the watches (and to how many),
 * the nutrition PDF, the quality days, a folder, a notification changed or approved, a
 * poll, the message, a part marked done or "not this week". The screen shows the last one
 * under each step and the whole week at the top. In app_settings.week_log —
 * `{ [weekStart]: LogEntry[] }`, weeks older than five dropped, a week capped — so there is
 * no migration; the writes are people's taps, never two at once in practice.
 */

/** The screen's steps: the owners' sections, and sending to the watches as the last one. */
export const STEPS = ['workouts', 'nutrition', 'quality', 'notifications', 'polls', 'message', 'watches'] as const;
export type Step = (typeof STEPS)[number];
/** Sending to the watches is the workouts' owner's. */
export const ownerSectionOf = (s: Step): Section => (s === 'watches' ? 'workouts' : s);

export type LogAction =
  | 'plan_uploaded' | 'plan_sent' | 'nutrition_uploaded' | 'quality_saved' | 'folder_made' | 'folder_changed'
  | 'notif_changed' | 'notif_approved' | 'notif_added' | 'poll_created' | 'message_sent' | 'done' | 'skipped' | 'unskipped';

export interface LogEntry {
  at: string;
  /** athletes.id of who did it; null for the system. */
  by: string | null;
  name: string;
  step: Step;
  action: LogAction;
  /** A short fact for the line: "19/21", "ג׳ · ו׳", the poll's question. */
  detail?: string;
}
export type LogStore = Record<string, LogEntry[]>;
export const LOG_KEY = 'week_log';
const KEEP_DAYS = 35;
const PER_WEEK = 200;

/** The store with one more entry for `weekStart`; old weeks dropped, the week capped (newest kept). */
export function withEntry(store: LogStore | null | undefined, weekStart: string, e: LogEntry, today: string): LogStore {
  const cutoff = addDays(today, -KEEP_DAYS);
  const next: LogStore = {};
  for (const [w, list] of Object.entries(store || {})) if (w >= cutoff && Array.isArray(list)) next[w] = list;
  next[weekStart] = [...(next[weekStart] || []), e].slice(-PER_WEEK);
  return next;
}

/** The newest entry per step. */
export function lastByStep(entries: LogEntry[] | undefined): Partial<Record<Step, LogEntry>> {
  const out: Partial<Record<Step, LogEntry>> = {};
  for (const e of entries || []) if (!out[e.step] || out[e.step]!.at <= e.at) out[e.step] = e;
  return out;
}

/** Whether a step was set aside for the week ("not this week"), and not undone since by doing it. */
export function skipped(entries: LogEntry[] | undefined, step: Step): boolean {
  const last = lastByStep(entries)[step];
  return last?.action === 'skipped';
}

/**
 * The week an action belongs to. A Saturday's work is for the week that starts the next
 * morning (that is the Saturday screen); any other day, the week it is in.
 */
export function weekOfAction(todayIsrael: string): string {
  const d = new Date(`${addDays(todayIsrael, 1)}T12:00:00Z`);
  return addDays(addDays(todayIsrael, 1), -d.getUTCDay());
}
