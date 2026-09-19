import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import {
  REVIEW_RESOLVED_KIND,
  RESOLVED_RECONCILE_WINDOW_HOURS,
  reviewResolvedLedgerTag,
} from '@/lib/feedback-notify';
import { shouldNotifyReporter } from '@/lib/feedback-resolution';

/**
 * 9a818a94 — "anyone who reports a problem should be told when it's closed".
 *
 * The notification was already built and already correct. What was broken was
 * WHERE it hung: off `PATCH /api/feedback`, while every real closure is a pasted
 * `UPDATE feedback SET status = 'done'`. Production had two of these against ~55
 * closed reports. So the things worth pinning here are not the copy — it was
 * fine — but the wiring that makes the state, rather than the click, the trigger.
 */
const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('review_resolved ledger', () => {
  it('keys the ledger on the report, so one report can only ever send once', () => {
    expect(reviewResolvedLedgerTag('abc')).toBe('review-resolved-abc');
    expect(reviewResolvedLedgerTag('abc')).not.toBe(reviewResolvedLedgerTag('abd'));
  });

  it('is the same tag the route used before this moved, so past sends still count', () => {
    // The two production rows that DID go out carry `review-resolved-<id>`. If
    // this ever drifts, the reconciliation pass stops seeing them as sent and
    // re-notifies whoever they belonged to.
    const id = '9a818a94-0000-0000-0000-000000000000';
    expect(reviewResolvedLedgerTag(id)).toBe(`review-resolved-${id}`);
  });

  it('uses the #ledger: convention the inbox already hides', () => {
    // notifyReportResolved stores `url: '#ledger:<tag>'`; GET /api/notifications/
    // inbox filters those out. A ledger row that reached the inbox would show a
    // member an internal sentinel.
    expect(read('lib/feedback-notify.ts')).toMatch(/url: `#ledger:\$\{tag\}`/);
    expect(read('app/api/notifications/inbox/route.ts')).toMatch(/#ledger:%/);
  });

  it('writes the ledger AFTER the send, not before', () => {
    // A ledger row written first would swallow the notification entirely if the
    // send threw — and this message gets exactly one chance.
    const src = read('lib/feedback-notify.ts');
    const sendAt = src.indexOf('await notifyAthlete(');
    const ledgerAt = src.indexOf("from('scheduled_notifications').insert(");
    expect(sendAt).toBeGreaterThan(-1);
    expect(ledgerAt).toBeGreaterThan(sendAt);
  });

  it('stays mutable-by-nobody: no category, so no preference can silence it', () => {
    // Same treatment as `approval` — it is a reply to a message this person sent
    // us. KIND_CATEGORY is what the settings toggles read.
    // Named only in prose there — a `review_resolved:` KEY would put it under a
    // category, and a category is a toggle.
    expect(read('lib/notifications/prefs.ts')).not.toMatch(/review_resolved\s*:/);
    expect(read('lib/feedback-notify.ts')).not.toMatch(/category:/);
    expect(REVIEW_RESOLVED_KIND).toBe('review_resolved');
  });
});

describe('the reconciliation pass', () => {
  it('runs on every tick and reports whether it could even look', () => {
    const tick = read('app/api/cron/tick/route.ts');
    expect(tick).toMatch(/reconcileResolvedReports\(supabase, now\)/);
    // In the response body, so a pass that can't read `resolved_at` is visible
    // rather than indistinguishable from a quiet one.
    expect(tick).toMatch(/resolvedReports,/);
    expect(read('lib/feedback-notify.ts')).toMatch(/available: false/);
  });

  it('is bounded, so no backfill mistake can turn into a mass send', () => {
    expect(RESOLVED_RECONCILE_WINDOW_HOURS).toBeGreaterThanOrEqual(24);
    expect(RESOLVED_RECONCILE_WINDOW_HOURS).toBeLessThanOrEqual(7 * 24);
    expect(read('lib/feedback-notify.ts')).toMatch(/\.gte\('resolved_at', since\)/);
  });

  it('only looks at closed reports that have an author', () => {
    const src = read('lib/feedback-notify.ts');
    expect(src).toMatch(/\.eq\('status', 'done'\)/);
    expect(src).toMatch(/\.not\('athlete_id', 'is', null\)/);
  });

  it('keeps the route on the same helper instead of its own copy of the send', () => {
    const route = read('app/api/feedback/route.ts');
    expect(route).toMatch(/notifyReportResolved\(supabase, \{/);
    // Two senders would mean two ledgers, which is the same as no ledger.
    expect(route).not.toMatch(/notifyAthlete\(\{[\s\S]*review_resolved/);
  });
});

describe('resolved_at is stamped by the database', () => {
  const migration = readFileSync(
    join(SRC, '../supabase/migrations/105_feedback_resolved_at.sql'),
    'utf8',
  );

  it('is a trigger, because a pasted UPDATE cannot be asked to remember a column', () => {
    expect(migration).toMatch(/CREATE TRIGGER feedback_resolved_at/);
    expect(migration).toMatch(/BEFORE INSERT OR UPDATE ON feedback/);
  });

  it('backfills the already-closed reports into the past', () => {
    // This is the line that stops ~55 people being congratulated for bugs they
    // reported weeks ago, the first time the pass runs.
    expect(migration).toMatch(/UPDATE feedback SET resolved_at = created_at WHERE status = 'done'/);
  });

  it('clears the stamp when a report is reopened', () => {
    expect(migration).toMatch(/NEW\.resolved_at := NULL/);
  });
});

describe('shouldNotifyReporter, still the route’s own gate', () => {
  // Unchanged behaviour, re-pinned here because the route now delegates the
  // sending and this is the only thing left standing between a fiddly triage save
  // and four notifications for one bug.
  it('fires once on the transition into done', () => {
    expect(shouldNotifyReporter('new', 'done', 'a1')).toBe(true);
    expect(shouldNotifyReporter('done', 'done', 'a1')).toBe(false);
    expect(shouldNotifyReporter('new', 'denied', 'a1')).toBe(false);
    expect(shouldNotifyReporter('new', 'done', null)).toBe(false);
  });
});
