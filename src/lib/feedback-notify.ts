import { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';
import { reviewResolvedCopy } from '@/lib/notifications/copy';

/**
 * Telling a reporter their report was closed — tied to the STATE, not to the act
 * of closing.
 *
 * ── Why this file exists (9a818a94) ──────────────────────────────────────────
 *
 * The notification itself already existed and was correct: `PATCH /api/feedback`
 * has sent it since the day it shipped. In production it had fired exactly TWICE,
 * against roughly fifty-five reports closed since — because reports are closed by
 * hand-pasted `UPDATE feedback SET status = 'done'` SQL, which never goes near
 * the route. The feature was hung off an action nobody performs.
 *
 * So the send is hung off the state instead. Anything that leaves a report in
 * `status = 'done'` — the route, a SQL paste, a future admin screen, a psql
 * session — gets the reporter told, because a cron pass reads the row rather than
 * watching the write.
 *
 * Two pieces make that safe:
 *
 *  1. `resolved_at`, stamped by a DB trigger (migration 105). A column set by the
 *     database is the only kind that a hand-pasted UPDATE can't forget. Without
 *     it, "resolved" is knowable but "resolved recently" is not, and a
 *     reconciliation pass over all of history would push fifty-five
 *     congratulations at people in one tick.
 *  2. A per-report ledger row, so the answer to "did we already tell them?" does
 *     not depend on which path did the telling. `notifyAthlete` does NOT dedupe —
 *     its `tag` only collapses notifications on the lock screen, it does not stop
 *     a second one being sent — so the check is ours to make.
 *
 * The route keeps its immediate send (a coach who marks something done should see
 * it land now, not within five minutes) and now writes the same ledger row, so
 * the cron pass stays quiet behind it.
 */

/**
 * Deliberately absent from KIND_CATEGORY (src/lib/notifications/prefs.ts) and
 * sent with no `category`, so no preference toggle can mute it — same treatment
 * as `approval`. It is a direct answer to a message this person sent us, not a
 * stream of chatter they might want quieter.
 */
export const REVIEW_RESOLVED_KIND = 'review_resolved';

/**
 * One tag per report. It does double duty: on the device it makes a re-resolved
 * report replace its own old notification instead of stacking, and in
 * `scheduled_notifications` it is the idempotency key, stashed as
 * `url = '#ledger:<tag>'` — the same convention cron/tick uses, and one the inbox
 * route already filters out of what members see.
 */
export function reviewResolvedLedgerTag(reportId: string): string {
  return `review-resolved-${reportId}`;
}

/**
 * How far back the reconciliation pass will look.
 *
 * Long enough that a few hours of cron trouble, or a `resolved_at` stamped while
 * the app was mid-deploy, still gets picked up; short enough that no mistake in a
 * backfill can turn into a mass send. The ledger is what actually prevents
 * duplicates — this is the belt to its braces, and the reason it is measured in
 * days rather than "all of history" is that the latter is exactly the shape of
 * accident worth making impossible.
 */
export const RESOLVED_RECONCILE_WINDOW_HOURS = 72;

export interface ResolvedReportRow {
  id: string;
  athlete_id: string | null;
  message: string | null;
  /** Migration 116. Absent until it is applied, and absent on every report closed
   *  before anybody recorded a fix version — in both cases the message simply
   *  doesn't name one, rather than naming a wrong one. */
  fixed_in_version?: string | null;
  /** Migration 120. Absent on the narrow retry; the title then just doesn't number it. */
  ticket_no?: number | null;
}

export type ResolvedNotifyResult = 'sent' | 'already' | 'no-reporter';

/**
 * Tell one report's author it was closed, at most once ever.
 *
 * Returns what happened rather than throwing, because both callers have already
 * done the work that matters (the status is saved either way) and neither should
 * turn a push problem into a failure.
 */
export async function notifyReportResolved(
  supabase: ReturnType<typeof createServerClient>,
  report: ResolvedReportRow,
): Promise<ResolvedNotifyResult> {
  // Pre-session reports and staff-filed ones have no author; there is nobody to
  // notify, and that is not an error.
  if (!report.athlete_id) return 'no-reporter';

  const tag = reviewResolvedLedgerTag(report.id);
  const { count } = await supabase
    .from('scheduled_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('kind', REVIEW_RESOLVED_KIND)
    .eq('url', `#ledger:${tag}`);
  if ((count || 0) > 0) return 'already';

  await notifyAthlete({
    athleteId: report.athlete_id,
    kind: REVIEW_RESOLVED_KIND,
    actorAthleteId: null,
    url: '/dashboard/review',
    tag,
    copy: (locale) => reviewResolvedCopy(locale, {
      preview: report.message,
      // The version to reload into. A PWA holding a stale service worker will keep
      // showing the bug, so "it's fixed" without a version is a message that reads
      // as a lie to the one person who did us a favour.
      fixedInVersion: report.fixed_in_version ?? null,
      ticketNo: report.ticket_no ?? null,
    }),
  });

  // After the send, not before: a ledger row written first would silently eat the
  // notification if `notifyAthlete` threw, and this is a message that gets one
  // chance. Written even when the athlete has no push subscription, because
  // `notifyAthlete` still leaves them an inbox row — which is the half of the
  // report that asked for the notification to show up inside the app.
  await supabase.from('scheduled_notifications').insert({
    kind: REVIEW_RESOLVED_KIND,
    title_he: 'review resolved', body_he: tag,
    audience_type: 'athlete', audience_id: report.athlete_id,
    schedule_type: 'now',
    status: 'sent', last_sent_at: new Date().toISOString(), sent_count: 1,
    url: `#ledger:${tag}`,
  });

  return 'sent';
}

/**
 * The state-driven pass: every recently-resolved report whose author was never
 * told, told. Safe to run on every tick — steady state is one cheap query that
 * finds nothing.
 */
export async function reconcileResolvedReports(
  supabase: ReturnType<typeof createServerClient>,
  now: Date,
): Promise<{ available: boolean; considered: number; sent: number; ids: string[] }> {
  const since = new Date(now.getTime() - RESOLVED_RECONCILE_WINDOW_HOURS * 3_600_000).toISOString();

  const pass = (columns: string) => supabase
    .from('feedback')
    .select(columns)
    .eq('status', 'done')
    .not('athlete_id', 'is', null)
    .gte('resolved_at', since);

  // Migration 116 adds `fixed_in_version`. Asking for a column that isn't there is
  // a 42703 on the whole query, so the narrow select is retried — losing the
  // version from the push is a downgrade, losing the push is a regression.
  let { data, error } = await pass('id, athlete_id, message, fixed_in_version, ticket_no');
  if (error && (error as { code?: string }).code === '42703') {
    ({ data, error } = await pass('id, athlete_id, message'));
  }

  // Migration 105 not applied yet: "we could not look" is not "there was nothing
  // to find", and it must not read as a healthy pass in the tick's JSON.
  if (error) return { available: false, considered: 0, sent: 0, ids: [] };

  // `as unknown` first: the select list is a runtime string here (the narrow retry),
  // so supabase-js can no longer infer a row type and widens it to its error shape.
  const rows = (data || []) as unknown as ResolvedReportRow[];
  const ids: string[] = [];
  for (const row of rows) {
    try {
      if ((await notifyReportResolved(supabase, row)) === 'sent') ids.push(row.id);
    } catch (err) {
      // One unreachable athlete must not stop the rest of the pass — and no
      // ledger row was written, so the next tick tries them again.
      console.error('[feedback] resolved notify failed for', row.id, err);
    }
  }

  return { available: true, considered: rows.length, sent: ids.length, ids };
}
