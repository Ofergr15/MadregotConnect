/**
 * Data retention windows (task 168). One table per rule; docs/data-retention.md is
 * the human copy and retentionPolicy.test.ts pins the two together.
 *
 * Every rule is conservative on purpose:
 *  - a window is several times longer than the longest read of that table in the app,
 *  - rows that carry meaning beyond their age are kept (idempotency ledgers, bounces,
 *    recurring schedules),
 *  - the job runs DRY by default (counts only) — it deletes only with RETENTION_PURGE=on.
 */

/** A filter step, applied to a Supabase query builder. Kept structural so tests can record calls. */
export type FilterStep =
  | { op: 'lt'; column: string; value: string }
  | { op: 'in'; column: string; values: string[] }
  | { op: 'notIn'; column: string; values: string[] }
  | { op: 'neq'; column: string; value: string }
  | { op: 'or'; expr: string };

export interface RetentionRule {
  /** Stable id for logs and the report. */
  id: string;
  table: string;
  /** The timestamp column the window is measured on. */
  column: string;
  days: number;
  /** Extra conditions a row must ALSO meet to go. */
  extra: FilterStep[];
  /** One line: why this window, and what is kept. */
  why: string;
}

export const DAY_MS = 86_400_000;

export const RETENTION_RULES: readonly RetentionRule[] = [
  {
    id: 'notifications',
    table: 'scheduled_notifications',
    column: 'updated_at',
    days: 400,
    extra: [
      { op: 'in', column: 'status', values: ['sent', 'cancelled'] },
      { op: 'neq', column: 'schedule_type', value: 'recurring' },
      // Idempotency ledgers ('#ledger:…' urls) are how a reminder knows it already went: never purged.
      // NULL-safe: `url NOT LIKE` alone would also keep every row with no url.
      { op: 'or', expr: 'url.is.null,url.not.like."#ledger:*"' },
    ],
    why: 'Inbox shows the newest 150; 400 days keeps a full year for anything deduped by year (birthdays). Ledger rows, recurring schedules and drafts/scheduled rows are kept.',
  },
  {
    id: 'push_deliveries',
    table: 'push_deliveries',
    column: 'sent_at',
    days: 90,
    extra: [],
    why: 'Push health drills into one notification’s deliveries (by nid); after 90 days that detail is no longer actionable.',
  },
  {
    id: 'client_events',
    table: 'client_events',
    column: 'created_at',
    days: 90,
    extra: [],
    why: 'Client logs/boots: the bug detector reads 7 days, the people screen 30. 90 days keeps a margin for investigations.',
  },
  {
    id: 'email_log',
    table: 'email_log',
    column: 'created_at',
    days: 365,
    extra: [{ op: 'notIn', column: 'status', values: ['bounced', 'complained'] }],
    why: 'Delivery history for a year. Bounces and complaints are kept: they are the record of an address that must not be mailed again.',
  },
  {
    id: 'race_positions',
    table: 'race_positions',
    column: 'at',
    days: 2,
    extra: [],
    why: 'Backstop to the race-live purge (24 h after poll_to), which only runs for races still marked active. Location data never outlives 2 days.',
  },
  {
    id: 'login_codes',
    table: 'login_codes',
    column: 'expires_at',
    days: 7,
    extra: [],
    why: 'One-time sign-in codes; useless after they expire. A week of history for support.',
  },
  {
    id: 'login_handoffs',
    table: 'login_handoffs',
    column: 'expires_at',
    days: 7,
    extra: [],
    why: 'One-time PWA sign-in handoffs; same as login codes.',
  },
];

/** The cutoff instant for a rule: rows whose `column` is strictly before it are due. */
export function cutoffFor(rule: RetentionRule, nowMs: number): string {
  return new Date(nowMs - rule.days * DAY_MS).toISOString();
}

/** The full filter for a rule at `nowMs`: the age condition first, then the rule's extras. */
export function filtersFor(rule: RetentionRule, nowMs: number): FilterStep[] {
  return [{ op: 'lt', column: rule.column, value: cutoffFor(rule, nowMs) }, ...rule.extra];
}
