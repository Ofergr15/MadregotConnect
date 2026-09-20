/**
 * A report's life after "new" — the rules the panel is read by, kept out of the
 * component so they can be tested and so the staff panel and the reporter's own
 * list cannot disagree about the same row.
 *
 * ── WHY THIS EXISTS (the bug panel rework) ──────────────────────────────────
 *
 * The panel used to sort by `status` alone and group everything into five flat
 * sections. That answered "what state is this in" and nothing else, so three
 * questions had no home at all:
 *
 *  1. WHAT FIXED IT. Six bugs fixed in 2.40.35 still read as untouched, because
 *     the only record of the fix was one overwritten line of `admin_notes`.
 *  2. IS IT REALLY FIXED. `done` is staff's opinion. A reporter on a stale
 *     service worker reopens the app, still sees the bug, and stops reporting.
 *     `verified_at` is the reporter's opinion, and it is the one that closes.
 *  3. IS THIS THE SAME THING. Four people reporting one bug was four rows to
 *     triage four times, which is most of what made the inbox feel endless.
 *
 * Everything here degrades to today's behaviour when migration 116 has not been
 * applied — every new column reads as null, and a null puts the row back in
 * exactly the view `status` alone would have put it in.
 */

import { normalizeStatus, type FeedbackStatus } from './status';

/**
 * The five drawers the panel is divided into. Not the same axis as `status`:
 * these are "what do I do with this screen today", and one report is in exactly
 * one of them.
 */
export type FeedbackView = 'inbox' | 'flight' | 'shipped' | 'archive' | 'ideas';

export const FEEDBACK_VIEWS: FeedbackView[] = ['inbox', 'flight', 'shipped', 'archive', 'ideas'];

/** next-intl keys in the `settings` namespace. */
export const VIEW_LABEL_KEY: Record<FeedbackView, string> = {
  inbox: 'viewInbox',
  flight: 'viewFlight',
  shipped: 'viewShipped',
  archive: 'viewArchive',
  ideas: 'viewIdeas',
};

/** The subset of a feedback row the lifecycle rules read. */
export interface LifecycleRow {
  id: string;
  category?: string | null;
  status?: string | null;
  duplicate_of?: string | null;
  verified_at?: string | null;
  archived_at?: string | null;
  fixed_in_version?: string | null;
  /** Migration 093's diagnostics; only the app version matters here. Named the
   *  way ReviewContext names it, so a real row is assignable without a cast. */
  context?: { appVersion?: string | null } | null;
}

/**
 * Which drawer a report belongs in.
 *
 * Ordered, not a lookup, because the conditions overlap and the order IS the
 * policy: archived beats everything (it was filed on purpose), a merged copy is
 * never its own row to triage, and only then does `status` get a say.
 *
 * A feature request that nobody has triaged goes to `ideas`, not `inbox`. Four of
 * fourteen open reports were wishes, and a wish sitting in a bug inbox makes the
 * red count a number you learn to ignore.
 */
export function feedbackView(row: LifecycleRow): FeedbackView {
  if (row.archived_at) return 'archive';
  // A duplicate is not a row you decide anything about — the primary carries it.
  if (row.duplicate_of) return 'archive';

  const status = normalizeStatus(row.status);
  if (status === 'denied') return 'archive';
  // Fixed, and the reporter has said so. Nothing left to wait for.
  if (status === 'done') return row.verified_at ? 'archive' : 'shipped';
  if (status === 'sprint') return 'flight';
  if (status === 'idea') return 'ideas';
  return row.category === 'feature_request' ? 'ideas' : 'inbox';
}

/** Per-view counts for the switcher, including the zeros — an absent chip moves
 *  the others and makes the row jump every time a report changes state. */
export function viewCounts(rows: LifecycleRow[]): Record<FeedbackView, number> {
  const counts: Record<FeedbackView, number> = {
    inbox: 0, flight: 0, shipped: 0, archive: 0, ideas: 0,
  };
  for (const row of rows) counts[feedbackView(row)] += 1;
  return counts;
}

/**
 * Compare two app versions ("2.40.94").
 *
 * Returns <0, 0 or >0. Missing or unparseable parts count as 0, so a null and a
 * "" sort equal and never throw — this runs on user-supplied diagnostics from a
 * year of reports, and the wrong answer is acceptable where a crash is not.
 * Deliberately NOT semver: no pre-release tags, no ranges, three numbers.
 */
export function compareAppVersions(a: string | null | undefined, b: string | null | undefined): number {
  const parts = (v: string | null | undefined) =>
    String(v || '').trim().split('.').map(n => Number.parseInt(n, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Whether the reporter is still on a build that HAS the bug.
 *
 * The version compared is the one collected when they filed the report, not a
 * live reading — the app has no version heartbeat. So this answers "the build
 * they were on when they reported it predates the fix", which is the honest
 * version of the question and is right in the case that matters: they reported
 * it, we fixed it, and nothing has told them to reload.
 *
 * Unknowable (no fix version recorded, or no diagnostics on a pre-093 report)
 * returns false: the notice it drives is a nudge to reload, and nudging someone
 * on no evidence is how a panel teaches you to distrust it.
 */
export function reporterNeedsReload(row: LifecycleRow): boolean {
  const on = row.context?.appVersion;
  if (!row.fixed_in_version || !on) return false;
  return compareAppVersions(on, row.fixed_in_version) < 0;
}

/** One issue: the report that was decided, plus every other report of the same thing. */
export interface FeedbackIssue<T extends LifecycleRow> {
  primary: T;
  /** The merged copies, newest-first as they arrived in the input. */
  duplicates: T[];
  /** How many people reported this, counting the primary. */
  reporterCount: number;
}

/**
 * Collapse `duplicate_of` chains into one issue per thing.
 *
 * Only ONE hop is followed. A → B → C is a triage mistake rather than a data
 * structure, and resolving it recursively would let a cycle written by a bad
 * paste hang the panel; a copy whose primary is itself a copy is attached to the
 * one it points at and shows up under that. Copies whose primary is not in the
 * page (it scrolled past the 100-row limit, or was hard-deleted) stay standalone
 * rather than vanishing — a report must never be invisible on every view.
 */
export function groupDuplicates<T extends LifecycleRow>(rows: T[]): FeedbackIssue<T>[] {
  const byId = new Map(rows.map(r => [r.id, r]));
  const dupes = new Map<string, T[]>();
  for (const row of rows) {
    const target = row.duplicate_of;
    if (!target || target === row.id || !byId.has(target)) continue;
    const list = dupes.get(target) || [];
    list.push(row);
    dupes.set(target, list);
  }
  const issues: FeedbackIssue<T>[] = [];
  for (const row of rows) {
    if (row.duplicate_of && byId.has(row.duplicate_of) && row.duplicate_of !== row.id) continue;
    const duplicates = dupes.get(row.id) || [];
    issues.push({ primary: row, duplicates, reporterCount: duplicates.length + 1 });
  }
  return issues;
}

/**
 * The status a triage decision implies, so the panel's one-tap "accept" and the
 * five-way control cannot drift apart.
 */
export const TRIAGE_DECISION: Record<'bug' | 'idea' | 'no', FeedbackStatus> = {
  bug: 'sprint',
  idea: 'idea',
  no: 'denied',
};
