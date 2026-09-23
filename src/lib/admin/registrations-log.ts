/**
 * יומן ההרשמות — the row states and filters behind the log (#82).
 *
 * The log moved to the People screen's shape: one flat list, ONE state pill per
 * row, and filter pills that are the questions it is opened with. Kept here, apart
 * from the component, for the same reason lib/admin/people.ts is: the pill and the
 * filter counts must agree, and a test can hold them to it.
 */

export type RegistrationStatus = 'pending' | 'approved' | 'rejected' | 'member';
export type RegistrationStage = 'emailed' | 'connected' | 'done';

export interface LogRow {
  status: RegistrationStatus;
  stage: RegistrationStage | RegistrationStatus;
  createdAt: string;
}

/**
 * Where a row stands. An approved row says its STAGE, never "approved": that is the
 * one thing the reader already knows, and it looked the same whether the mail
 * bounced or the person finished an hour ago.
 */
export type LogState = 'pending' | 'emailed' | 'connected' | 'done' | 'rejected' | 'member';

export function logState(r: LogRow): LogState {
  if (r.status === 'approved') {
    return r.stage === 'connected' || r.stage === 'done' ? r.stage : 'emailed';
  }
  return r.status;
}

/**
 * pending: waiting for a decision. stuck: approved and not in yet, the only
 * unfinished business nobody is reminded about. in: approved and done.
 */
export const LOG_FILTERS = ['pending', 'stuck', 'in', 'all'] as const;
export type LogFilter = (typeof LOG_FILTERS)[number];

export function matchesLogFilter(r: LogRow, f: LogFilter): boolean {
  const s = logState(r);
  if (f === 'pending') return s === 'pending';
  if (f === 'stuck') return s === 'emailed' || s === 'connected';
  if (f === 'in') return s === 'done';
  return true;
}

export function logCounts(rows: LogRow[]): Record<LogFilter, number> {
  const out = { pending: 0, stuck: 0, in: 0, all: 0 } as Record<LogFilter, number>;
  for (const r of rows) for (const f of LOG_FILTERS) if (matchesLogFilter(r, f)) out[f]++;
  return out;
}

/**
 * The filter the log opens on: the first one with anybody in it, so an approver
 * with nobody waiting lands on who is stuck rather than on an empty list.
 */
export function initialLogFilter(rows: LogRow[]): LogFilter {
  const c = logCounts(rows);
  return c.pending ? 'pending' : c.stuck ? 'stuck' : 'all';
}

/** A worklist reads oldest-first (who waited longest), a history newest-first. */
export function sortForLogFilter<T extends LogRow>(rows: T[], f: LogFilter): T[] {
  const asc = f === 'pending' || f === 'stuck';
  return rows.slice().sort((a, b) => (asc ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
}

/**
 * What to say when the list could not be loaded. Before #82 a refusal rendered as
 * "nothing here right now", which read as "nobody signed up" to an approver who
 * was in fact being turned away.
 */
export function logLoadErrorText(status: number | undefined): { title: string; hint: string } {
  if (status === 403) {
    return {
      title: 'השרת לא מאשר לחשבון הזה לראות את היומן',
      hint: 'היומן פתוח רק למי שמורשה לאשר הרשמות. אם זה אמור להיות אתה, כדאי להתנתק ולהתחבר מחדש.',
    };
  }
  if (status === 401) {
    return { title: 'החיבור פג', hint: 'צריך להתחבר מחדש כדי לראות את היומן.' };
  }
  return { title: 'היומן לא נטען', hint: 'משהו השתבש בשרת. אפשר לנסות שוב בעוד רגע.' };
}
